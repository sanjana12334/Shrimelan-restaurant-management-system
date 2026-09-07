import { Prisma, PrismaClient } from "@prisma/client";
import { generateOrderNumber as createOrderNumber } from "../security/tokens";

const TAX_RATE = 0.05; // 5%

// ---------------------------------------------------------
// TYPES
// ---------------------------------------------------------

interface VariantData {
  id: string;
  name: string;
  priceDelta: unknown;
}

interface AddonData {
  id: string;
  name: string;
  price: unknown;
  isActive: boolean;
}

export interface PricedLine {
  itemId: string;
  variantId?: string;
  itemNameSnap: string;
  variantNameSnap?: string;
  unitPriceSnap: number;
  quantity: number;
  addonsSnap: { name: string; price: number }[];
  instructions?: string;
  lineTotal: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Recomputes price entirely from the database.
 *
 * Client supplies only:
 * - itemId
 * - optional variantId
 * - quantity
 * - addonIds
 * - instructions
 *
 * Prices are always calculated from the database.
 */
export async function priceCart(
  prisma: PrismaClient | Prisma.TransactionClient,
  lines: {
    itemId: string;
    variantId?: string;
    quantity: number;
    addonIds: string[];
    instructions?: string;
  }[],
  branchId: string,
): Promise<PricedOrder> {
  if (lines.length > 50) throw new Error("Too many order lines");
  const priced: PricedLine[] = [];

  for (const line of lines) {
    // -------------------------------------------------------
    // QUANTITY VALIDATION
    // -------------------------------------------------------

    if (line.quantity < 1 || line.quantity > 20) {
      throw new Error(`Invalid quantity for item ${line.itemId}`);
    }

    // -------------------------------------------------------
    // GET MENU ITEM
    // -------------------------------------------------------

    const item = await prisma.menuItem.findUnique({
      where: { id: line.itemId },
      include: {
        category: { select: { branchId: true } },
        variants: true,
        addons: true,
      },
    });

    if (!item || item.category.branchId !== branchId || !item.isAvailable) {
      throw new Error(`Item ${line.itemId} is not available`);
    }

    // -------------------------------------------------------
    // VARIANT VALIDATION
    // -------------------------------------------------------

    let selectedVariant: VariantData | null = null;

    if (line.variantId) {
      selectedVariant = (item.variants as unknown as VariantData[]).find(
        (variant: VariantData) => variant.id === line.variantId
      ) ?? null;

      if (!selectedVariant) {
        throw new Error(
          `Variant ${line.variantId} does not belong to item ${line.itemId}`
        );
      }
    }

    // -------------------------------------------------------
    // ADDON VALIDATION
    // -------------------------------------------------------

    if (new Set(line.addonIds).size !== line.addonIds.length) {
      throw new Error(`Duplicate addon selected for item ${line.itemId}`);
    }

    const itemAddons = item.addons as unknown as AddonData[];

    const chosenAddons = itemAddons.filter(
      (addon: AddonData) =>
        line.addonIds.includes(addon.id) && addon.isActive
    );

    // Make sure every requested addon is valid.
    if (chosenAddons.length !== line.addonIds.length) {
      throw new Error(
        `Invalid or inactive addon selected for item ${line.itemId}`
      );
    }

    // -------------------------------------------------------
    // PRICE CALCULATION
    // -------------------------------------------------------

    const basePrice = Number(item.price);

    const variantPriceDelta = selectedVariant
      ? Number(selectedVariant.priceDelta)
      : 0;

    const addonsTotal = chosenAddons.reduce(
      (sum: number, addon: AddonData): number =>
        sum + Number(addon.price),
      0
    );

    const unitPrice =
      basePrice +
      variantPriceDelta +
      addonsTotal;

    // -------------------------------------------------------
    // CREATE PRICED LINE
    // -------------------------------------------------------

    priced.push({
      itemId: item.id,
      variantId: selectedVariant?.id,
      itemNameSnap: item.name,
      variantNameSnap: selectedVariant?.name,
      unitPriceSnap: unitPrice,
      quantity: line.quantity,

      addonsSnap: chosenAddons.map(
        (addon: AddonData) => ({
          name: addon.name,
          price: Number(addon.price),
        })
      ),

      instructions: line.instructions,

      lineTotal: unitPrice * line.quantity,
    });
  }

  // ---------------------------------------------------------
  // ORDER TOTALS
  // ---------------------------------------------------------

  const subtotal =
    Math.round(
      priced.reduce(
        (sum: number, line: PricedLine): number =>
          sum + line.lineTotal,
        0
      ) * 100
    ) / 100;

  const tax =
    Math.round(subtotal * TAX_RATE * 100) / 100;

  const total =
    Math.round((subtotal + tax) * 100) / 100;

  return {
    lines: priced,
    subtotal,
    tax,
    total,
  };
}

/**
 * Generates a human-readable order number.
 *
 * Example:
 * SM-20260905-4821
 */
export function generateOrderNumber(): string {
  return createOrderNumber();
}
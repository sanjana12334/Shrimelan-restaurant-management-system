import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CartLine, MenuItem, MenuVariant, MenuAddon } from "../types";

const CART_KEY = "shrimelan.cart.v1";
const TAX_RATE = 0.05; // Mirrors backend/src/services/pricing.service.ts — for
// display estimate only. The server is the sole source of truth for the
// real subtotal/tax/total; it recomputes everything from the database on
// order creation and this estimate is never sent anywhere.

function buildLineKey(itemId: string, variantId: string | undefined, addonIds: string[], instructions: string | undefined): string {
  return [itemId, variantId ?? "", [...addonIds].sort().join(","), instructions ?? ""].join("::");
}

interface AddToCartInput {
  item: MenuItem;
  variant?: MenuVariant;
  addons: MenuAddon[];
  quantity: number;
  instructions?: string;
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  estimatedTax: number;
  estimatedTotal: number;
  addToCart: (input: AddToCartInput) => void;
  updateQuantity: (lineKey: string, quantity: number) => void;
  removeLine: (lineKey: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function loadInitialLines(): CartLine[] {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(loadInitialLines);

  useEffect(() => {
    sessionStorage.setItem(CART_KEY, JSON.stringify(lines));
  }, [lines]);

  const addToCart = useCallback(({ item, variant, addons, quantity, instructions }: AddToCartInput) => {
    const addonIds = addons.map((a) => a.id);
    const lineKey = buildLineKey(item.id, variant?.id, addonIds, instructions);
    const unitPrice =
      Number(item.price) + (variant ? Number(variant.priceDelta) : 0) + addons.reduce((sum, a) => sum + Number(a.price), 0);

    setLines((prev) => {
      const existing = prev.find((l) => l.lineKey === lineKey);
      if (existing) {
        return prev.map((l) => (l.lineKey === lineKey ? { ...l, quantity: l.quantity + quantity } : l));
      }
      const newLine: CartLine = {
        lineKey,
        itemId: item.id,
        itemName: item.name,
        itemImageUrl: item.imageUrl,
        isVeg: item.isVeg,
        variantId: variant?.id,
        variantName: variant?.name,
        addonIds,
        addonNames: addons.map((a) => a.name),
        unitPrice,
        quantity,
        instructions,
      };
      return [...prev, newLine];
    });
  }, []);

  const updateQuantity = useCallback((lineKey: string, quantity: number) => {
    setLines((prev) => {
      if (quantity <= 0) return prev.filter((l) => l.lineKey !== lineKey);
      return prev.map((l) => (l.lineKey === lineKey ? { ...l, quantity: Math.min(quantity, 20) } : l));
    });
  }, []);

  const removeLine = useCallback((lineKey: string) => {
    setLines((prev) => prev.filter((l) => l.lineKey !== lineKey));
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const { itemCount, subtotal } = useMemo(() => {
    return lines.reduce(
      (acc, line) => ({
        itemCount: acc.itemCount + line.quantity,
        subtotal: acc.subtotal + line.unitPrice * line.quantity,
      }),
      { itemCount: 0, subtotal: 0 },
    );
  }, [lines]);

  const estimatedTax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const estimatedTotal = Math.round((subtotal + estimatedTax) * 100) / 100;

  const value = useMemo(
    () => ({ lines, itemCount, subtotal, estimatedTax, estimatedTotal, addToCart, updateQuantity, removeLine, clearCart }),
    [lines, itemCount, subtotal, estimatedTax, estimatedTotal, addToCart, updateQuantity, removeLine, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}

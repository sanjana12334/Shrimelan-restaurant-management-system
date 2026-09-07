import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { requireTrustedOrigin } from "../middleware/origin";
import { validateBody } from "../middleware/validate";
import { AUDIT_ACTIONS, recordAudit } from "../services/audit.service";

export const adminMenuRouter = Router();
adminMenuRouter.use(requireAdmin);

const itemFields = {
  categoryId: z.string().trim().min(1).max(120),
  itemCode: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  price: z.number().finite().nonnegative(),
  imageUrl: z.string().trim().max(2_000),
  isVeg: z.boolean(),
  isBestseller: z.boolean(),
  isAvailable: z.boolean(),
};

const createItemSchema = z.object(itemFields).strict();
const updateItemSchema = z.object(itemFields).partial().strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});

function routeError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

async function findBranchCategory(categoryId: string, branchId: string) {
  return prisma.menuCategory.findFirst({ where: { id: categoryId, branchId }, select: { id: true } });
}

adminMenuRouter.get("/menu", async (req, res, next) => {
  try {
    const categories = await prisma.menuCategory.findMany({
      where: { branchId: req.staff!.branchId },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        items: {
          orderBy: { name: "asc" },
          select: {
            id: true, itemCode: true, name: true, description: true, price: true,
            isVeg: true, isBestseller: true, isAvailable: true, imageUrl: true,
          },
        },
      },
    });
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

adminMenuRouter.post("/menu/items", requireTrustedOrigin, validateBody(createItemSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createItemSchema>;
    const category = await findBranchCategory(body.categoryId, req.staff!.branchId);
    if (!category) return next(routeError("Menu category not found", 404));

    const duplicate = await prisma.menuItem.findUnique({ where: { itemCode: body.itemCode }, select: { id: true } });
    if (duplicate) return next(routeError("Item code is already in use", 409));

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.menuItem.create({ data: body });
      await recordAudit(tx, {
        actorId: req.staff!.staffId, action: AUDIT_ACTIONS.MENU_ITEM_CREATED,
        targetType: "MenuItem", targetId: created.id, branchId: req.staff!.branchId, ipAddress: req.ip,
        metadata: { itemCode: created.itemCode, name: created.name, price: created.price.toString() },
      });
      return created;
    });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

adminMenuRouter.patch("/menu/items/:id", requireTrustedOrigin, validateBody(updateItemSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateItemSchema>;
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.menuItem.findFirst({
        where: { id: req.params.id, category: { branchId: req.staff!.branchId } },
        select: { id: true, itemCode: true, price: true, isAvailable: true },
      });
      if (!existing) throw routeError("Menu item not found", 404);

      if (body.categoryId) {
        const category = await tx.menuCategory.findFirst({
          where: { id: body.categoryId, branchId: req.staff!.branchId }, select: { id: true },
        });
        if (!category) throw routeError("Menu category not found", 404);
      }
      if (body.itemCode && body.itemCode !== existing.itemCode) {
        const duplicate = await tx.menuItem.findUnique({ where: { itemCode: body.itemCode }, select: { id: true } });
        if (duplicate) throw routeError("Item code is already in use", 409);
      }

      const updated = await tx.menuItem.update({ where: { id: existing.id }, data: body });
      await recordAudit(tx, {
        actorId: req.staff!.staffId, action: AUDIT_ACTIONS.MENU_ITEM_UPDATED,
        targetType: "MenuItem", targetId: updated.id, branchId: req.staff!.branchId, ipAddress: req.ip,
        metadata: { changedFields: Object.keys(body) },
      });
      if (body.price !== undefined && body.price !== Number(existing.price)) {
        await recordAudit(tx, {
          actorId: req.staff!.staffId, action: AUDIT_ACTIONS.MENU_ITEM_PRICE_CHANGED,
          targetType: "MenuItem", targetId: updated.id, branchId: req.staff!.branchId, ipAddress: req.ip,
          metadata: { previousPrice: existing.price.toString(), price: updated.price.toString() },
        });
      }
      if (body.isAvailable !== undefined && body.isAvailable !== existing.isAvailable) {
        await recordAudit(tx, {
          actorId: req.staff!.staffId, action: AUDIT_ACTIONS.MENU_ITEM_AVAILABILITY_CHANGED,
          targetType: "MenuItem", targetId: updated.id, branchId: req.staff!.branchId, ipAddress: req.ip,
          metadata: { previousAvailability: existing.isAvailable, isAvailable: updated.isAvailable },
        });
      }
      return updated;
    });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

adminMenuRouter.delete("/menu/items/:id", requireTrustedOrigin, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.menuItem.findFirst({
        where: { id: req.params.id, category: { branchId: req.staff!.branchId } },
        select: { id: true, itemCode: true, name: true, _count: { select: { orderItems: true, cartItems: true } } },
      });
      if (!existing) throw routeError("Menu item not found", 404);
      if (existing._count.orderItems > 0 || existing._count.cartItems > 0) {
        throw routeError("This item has order history and cannot be deleted. Mark it unavailable instead.", 409);
      }
      await tx.menuItem.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actorId: req.staff!.staffId, action: AUDIT_ACTIONS.MENU_ITEM_DELETED,
        targetType: "MenuItem", targetId: existing.id, branchId: req.staff!.branchId, ipAddress: req.ip,
        metadata: { itemCode: existing.itemCode, name: existing.name },
      });
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { attachTableSession, requireTableSession } from "../middleware/table-session.middleware";

export const menuRouter = Router();

/**
 * GET /api/public/menu
 * Public, unauthenticated. Returns ONLY customer-safe fields.
 * Never includes: costToMake, stockQty, supplier info, or any other
 * internal field — selected explicitly below rather than spreading the
 * Prisma row, so a future schema field can't leak by accident.
 */
menuRouter.get("/menu", attachTableSession, requireTableSession, async (req, res, next) => {
  try {
    const categories = await prisma.menuCategory.findMany({
      where: { branchId: req.tableSession!.branchId },
      orderBy: { sortOrder: "asc" },
      // Top-level `select` (not `include`) so the category row itself is
      // scoped down too — `include` alone would still return every scalar
      // column on MenuCategory, leaking the internal `branchId` to the
      // customer response even though it's only ever used server-side to
      // filter. Nothing about branchId is customer-facing menu content.
      select: {
        id: true,
        name: true,
        sortOrder: true,
        items: {
          where: { isAvailable: true },
          select: {
            id: true,
            itemCode: true,
            name: true,
            description: true,
            price: true,
            isVeg: true,
            rating: true,
            imageUrl: true,
            isBestseller: true,
            variants: { select: { id: true, name: true, priceDelta: true } },
            addons: {
              where: { isActive: true },
              select: { id: true, name: true, price: true },
            },
          },
        },
      },
    });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

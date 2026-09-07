import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";

export const adminStaffRouter = Router();

adminStaffRouter.use(requireAdmin);

adminStaffRouter.get("/staff", async (req, res, next) => {
  try {
    const staff = await prisma.staff.findMany({
      where: {
        branchId: req.staff!.branchId,
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    res.json({ staff });
  } catch (err) {
    next(err);
  }
});
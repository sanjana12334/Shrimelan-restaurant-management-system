import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { requireTrustedOrigin } from "../middleware/origin";
import { validateBody } from "../middleware/validate";
import { getIO } from "../sockets/io";
import { transitionOrderStatus } from "../services/order-state.service";
import { markOrderPaid } from "../services/payment.service";

export const staffOrderRouter = Router();

staffOrderRouter.use(requireAdmin);

staffOrderRouter.get("/staff/orders", async (req, res, next) => {
  try {
    const scope = req.query.scope === "all" ? "all" : "active";

    const orders = await prisma.order.findMany({
      where: {
        branchId: req.staff!.branchId,
        ...(scope === "active"
          ? { status: { notIn: ["COMPLETED", "CANCELLED"] } }
          : {}),
      },
      include: {
        items: true,
        statusHistory: { orderBy: { changedAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

const statusSchema = z
  .object({
    status: z.enum(["CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED"]),
  })
  .strict();

staffOrderRouter.patch(
  "/staff/orders/:id/status",
  requireTrustedOrigin,
  validateBody(statusSchema),
  async (req, res, next) => {
    try {
      const result = await transitionOrderStatus(
        prisma,
        {
          staffId: req.staff!.staffId,
          branchId: req.staff!.branchId,
        },
        req.params.id,
        req.body.status,
        req.ip,
      );

      getIO().to(`branch:${result.branchId}`).emit("order:updated", {
        orderId: result.id,
        status: result.status,
      });

      res.json({
        id: result.id,
        status: result.status,
      });
    } catch (err) {
      next(err);
    }
  },
);

const paymentSchema = z
  .object({
    paymentMethod: z.enum(["CASH", "UPI", "CARD"]),
  })
  .strict();

staffOrderRouter.patch(
  "/staff/orders/:id/mark-paid",
  requireTrustedOrigin,
  validateBody(paymentSchema),
  async (req, res, next) => {
    try {
      const result = await markOrderPaid(
        prisma,
        {
          staffId: req.staff!.staffId,
          branchId: req.staff!.branchId,
        },
        req.params.id,
        req.body.paymentMethod,
        req.ip,
      );

      getIO().to(`branch:${result.branchId}`).emit("order:paid", {
        orderId: result.id,
      });

      res.json({
        id: result.id,
        paymentStatus: result.paymentStatus,
        paymentMethod: result.paymentMethod,
        paidAt: result.paidAt,
      });
    } catch (err) {
      next(err);
    }
  },
);
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validate";
import { attachTableSession, requireTableSession } from "../middleware/table-session.middleware";
import { requireTrustedOrigin } from "../middleware/origin";
import { priceCart } from "../services/pricing.service";
import { createOpaqueToken, generateOrderNumber, hashToken } from "../security/tokens";
import { getIO } from "../sockets/io";
import { AUDIT_ACTIONS, recordAudit } from "../services/audit.service";
import { createOrderSchema } from "./order.schemas";

export const orderRouter = Router();

function errorWithStatus(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function publicOrderResponse(order: {
  orderNumber: string;
  total: Prisma.Decimal;
  status: string;
  paymentStatus: string;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  items: Array<{
    itemNameSnap: string;
    variantNameSnap: string | null;
    unitPriceSnap: Prisma.Decimal;
    quantity: number;
    addonsSnap: Prisma.JsonValue | null;
    instructions: string | null;
  }>;
  statusHistory: Array<{ status: string; changedAt: Date }>;
}, accessToken?: string) {
  return {
    orderNumber: order.orderNumber,
    ...(accessToken ? { accessToken } : {}),
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: order.total.toString(),
    items: order.items.map((item) => ({
      name: item.itemNameSnap,
      variant: item.variantNameSnap,
      unitPrice: item.unitPriceSnap.toString(),
      quantity: item.quantity,
      addons: item.addonsSnap,
      instructions: item.instructions,
    })),
    // Customer-safe timestamps only. `paidAt` is null until an ADMIN
    // records counter payment; no payer/payment-method identity or any
    // other admin/audit field is ever included here (see AuditLog, which
    // customers never have any route to reach).
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    statusHistory: order.statusHistory.map((history) => ({
      status: history.status,
      changedAt: history.changedAt,
    })),
  };
}

const orderInclude = {
  items: {
    select: {
      itemNameSnap: true,
      variantNameSnap: true,
      unitPriceSnap: true,
      quantity: true,
      addonsSnap: true,
      instructions: true,
    },
  },
  statusHistory: {
    select: { status: true, changedAt: true },
    orderBy: { changedAt: "asc" as const },
  },
};


/**
 * QR -> TableSession -> server-side menu validation -> Order.
 * The request has no authoritative table, branch, price, total, or payment
 * fields. All of those values are resolved or computed inside the transaction.
 */
orderRouter.post(
  "/orders",
  requireTrustedOrigin,
  attachTableSession,
  requireTableSession,
  validateBody(createOrderSchema),
  async (req, res, next) => {
    try {
      const rawIdempotencyKey = req.get("Idempotency-Key");
      if (!rawIdempotencyKey || rawIdempotencyKey.length < 16 || rawIdempotencyKey.length > 128) {
        return res.status(400).json({ error: "A valid Idempotency-Key header is required" });
      }
      if (!/^[\x21-\x7e]+$/.test(rawIdempotencyKey)) {
        return res.status(400).json({ error: "Invalid Idempotency-Key header" });
      }

      const body = req.body as z.infer<typeof createOrderSchema>;
      const sessionId = req.tableSession!.id;
      const idempotencyKey = hashToken(rawIdempotencyKey);
      let rawAccessToken: string | undefined;
      let order: Awaited<ReturnType<typeof prisma.order.create>> & {
        items: Array<{
          itemNameSnap: string;
          variantNameSnap: string | null;
          unitPriceSnap: Prisma.Decimal;
          quantity: number;
          addonsSnap: Prisma.JsonValue | null;
          instructions: string | null;
        }>;
        statusHistory: Array<{ status: string; changedAt: Date }>;
      };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        rawAccessToken = undefined;
        try {
          order = await prisma.$transaction(async (tx) => {
            const session = await tx.tableSession.findFirst({
              where: {
                id: sessionId,
                revokedAt: null,
                expiresAt: { gt: new Date() },
                table: { active: true },
              },
              select: {
                id: true,
                tableId: true,
                branchId: true,
                qrVersion: true,
                table: { select: { qrVersion: true, branchId: true } },
              },
            });
            if (
              !session ||
              session.qrVersion !== session.table.qrVersion ||
              session.branchId !== session.table.branchId
            ) {
              throw errorWithStatus("Table session expired or revoked", 401);
            }

            const existing = await tx.order.findFirst({
              where: { idempotencyScope: session.id, idempotencyKey },
              include: orderInclude,
            });
            if (existing) return existing;

            const priced = await priceCart(tx, body.lines, session.branchId);
            rawAccessToken = createOpaqueToken(32);
            const created = await tx.order.create({
              data: {
                orderNumber: generateOrderNumber(),
                branchId: session.branchId,
                customerName: body.customerName,
                customerPhone: body.customerPhone,
                orderType: "DINE_IN",
                orderSource: "QR",
                tableId: session.tableId,
                tableSessionId: session.id,
                note: body.note,
                subtotal: priced.subtotal,
                tax: priced.tax,
                total: priced.total,
                accessTokenHash: hashToken(rawAccessToken),
                idempotencyKey,
                idempotencyScope: session.id,
                status: "RECEIVED",
                paymentStatus: "UNPAID",
                items: {
                  create: priced.lines.map((line) => ({
                    itemId: line.itemId,
                    variantId: line.variantId,
                    itemNameSnap: line.itemNameSnap,
                    variantNameSnap: line.variantNameSnap,
                    unitPriceSnap: line.unitPriceSnap,
                    quantity: line.quantity,
                    addonsSnap: line.addonsSnap,
                    instructions: line.instructions,
                  })),
                },
                statusHistory: { create: { status: "RECEIVED" } },
              },
              include: orderInclude,
            });
            // No authenticated actor — this is a customer, not staff — so
            // actorId is intentionally null. Keep metadata to safe,
            // non-identifying facts (item count and total are not secrets;
            // the raw access token/table-session token never go anywhere
            // near this call).
            await recordAudit(tx, {
              actorId: null,
              action: AUDIT_ACTIONS.ORDER_CREATED,
              targetType: "Order",
              targetId: created.id,
              branchId: session.branchId,
              ipAddress: req.ip,
              metadata: {
                orderSource: "QR",
                tableId: session.tableId,
                itemCount: created.items.length,
                total: created.total.toString(),
              },
            });
            return created;
          });
          break;
        } catch (error) {
          const isUniqueConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
          if (!isUniqueConflict || attempt === 2) throw error;
        }
      }

      if (!order!) throw new Error("Order creation failed");
      const created = Boolean(rawAccessToken);
      if (!created) {
        const suppliedAccessToken = req.get("X-Order-Access-Token");
        if (suppliedAccessToken) {
          const matches = await prisma.order.findFirst({
            where: { orderNumber: order.orderNumber, accessTokenHash: hashToken(suppliedAccessToken) },
            select: { id: true },
          });
          if (matches) rawAccessToken = suppliedAccessToken;
        }
      }
      getIO().to(`branch:${req.tableSession!.branchId}`).emit("order:new", { orderNumber: order.orderNumber });
      res.status(created ? 201 : 200).json(publicOrderResponse(order, rawAccessToken));
    } catch (err) {
      if (err instanceof Error && /Invalid quantity|not available|does not belong|Invalid or inactive|Duplicate addon|Too many order lines/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  },
);

orderRouter.get("/orders/:orderNumber", async (req, res, next) => {
  try {
    const accessToken = req.get("X-Order-Access-Token");
    if (!accessToken || accessToken.length < 43) {
      return res.status(404).json({ error: "Order not found" });
    }
    const order = await prisma.order.findFirst({
      where: { orderNumber: req.params.orderNumber, accessTokenHash: hashToken(accessToken) },
      include: orderInclude,
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(publicOrderResponse(order));
  } catch (err) {
    next(err);
  }
});

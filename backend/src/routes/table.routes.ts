import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { attachTableSession, requireTableSession } from "../middleware/table-session.middleware";
import { requireTrustedOrigin } from "../middleware/origin";
import { validateBody } from "../middleware/validate";
import { getConfig } from "../config/env";
import { createOpaqueToken, hashToken } from "../security/tokens";
import { AUDIT_ACTIONS, recordAudit } from "../services/audit.service";
import {
  createTableSession,
  resolveTableFromQrCredential,
  TableSessionError,
} from "../services/table-session.service";
import { qrSessionSchema } from "./table.schemas";

export const publicTableRouter = Router();
export const adminTableRouter = Router();

function tableSessionCookieOptions() {
  const config = getConfig();
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
    maxAge: config.tableSessionTtlMs,
  };
}

publicTableRouter.post(
  "/",
  requireTrustedOrigin,
  validateBody(qrSessionSchema),
  async (req, res, next) => {
    try {
      const config = getConfig();
      // The request body has already been validated + stripped down to
      // exactly `{ token }` by qrSessionSchema's `.strict()` — any
      // tableId/branchId a client tried to smuggle in was rejected at 400
      // before this handler ever runs (see table.routes.qr-schema.test.ts).
      const table = await resolveTableFromQrCredential(prisma, req.body.token);
      const session = await createTableSession(prisma, table, config.tableSessionTtlMs);

      res.cookie(config.sessionCookieName, session.rawSessionToken, tableSessionCookieOptions());
      // Only customer-safe fields go in the response body — no table id,
      // branch id, or session id.
      res.json({ ok: true, tableLabel: session.tableLabel, expiresAt: session.expiresAt });
    } catch (err) {
      if (err instanceof TableSessionError) {
        return res.status(err.status).json({ error: err.message });
      }
      next(err);
    }
  },
);

publicTableRouter.get("/", attachTableSession, requireTableSession, (req, res) => {
  res.json({ ok: true, expiresAt: req.tableSession!.expiresAt });
});

const tableSchema = z.object({ label: z.string().trim().min(1).max(80) }).strict();

adminTableRouter.use(requireAdmin);

adminTableRouter.get("/tables", async (req, res, next) => {
  try {
    const tables = await prisma.restaurantTable.findMany({
      where: { branchId: req.staff!.branchId },
      select: { id: true, label: true, active: true, qrVersion: true, createdAt: true, updatedAt: true },
      orderBy: { label: "asc" },
    });
    res.json({ tables });
  } catch (err) {
    next(err);
  }
});

adminTableRouter.post("/tables", requireTrustedOrigin, validateBody(tableSchema), async (req, res, next) => {
  try {
    const rawQrToken = createOpaqueToken(32);
    const table = await prisma.$transaction(async (tx) => {
      const created = await tx.restaurantTable.create({
        data: {
          branchId: req.staff!.branchId,
          label: req.body.label,
          qrTokenHash: hashToken(rawQrToken),
        },
        select: { id: true, label: true, qrVersion: true },
      });
      await recordAudit(tx, {
        actorId: req.staff!.staffId,
        action: AUDIT_ACTIONS.TABLE_CREATED,
        targetType: "RestaurantTable",
        targetId: created.id,
        branchId: req.staff!.branchId,
        ipAddress: req.ip,
        metadata: { label: created.label },
      });
      await recordAudit(tx, {
        actorId: req.staff!.staffId,
        action: AUDIT_ACTIONS.QR_GENERATED,
        targetType: "RestaurantTable",
        targetId: created.id,
        branchId: req.staff!.branchId,
        ipAddress: req.ip,
        metadata: { qrVersion: created.qrVersion },
      });
      return created;
    });
    res.status(201).json({
      table,
      qrUrl: `${getConfig().appBaseUrl}/order?t=${encodeURIComponent(rawQrToken)}`,
      qrToken: rawQrToken,
      warning: "Store or print this QR now. The raw token will not be shown again.",
    });
  } catch (err) {
    next(err);
  }
});
const updateTableSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.label !== undefined || body.active !== undefined, {
    message: "Provide a label or active status.",
  });

adminTableRouter.patch(
  "/tables/:id",
  requireTrustedOrigin,
  validateBody(updateTableSchema),
  async (req, res, next) => {
    try {
      const existing = await prisma.restaurantTable.findFirst({
        where: { id: req.params.id, branchId: req.staff!.branchId },
      });

      if (!existing) {
        return res.status(404).json({ error: "Table not found" });
      }

      const table = await prisma.$transaction(async (tx) => {
        const updated = await tx.restaurantTable.update({
          where: { id: existing.id },
          data: {
            ...(req.body.label !== undefined ? { label: req.body.label } : {}),
            ...(req.body.active !== undefined ? { active: req.body.active } : {}),
          },
          select: {
            id: true,
            label: true,
            active: true,
            qrVersion: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (req.body.active === false && existing.active) {
          await tx.tableSession.updateMany({
            where: { tableId: existing.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });

          await recordAudit(tx, {
            actorId: req.staff!.staffId,
            action: AUDIT_ACTIONS.TABLE_DEACTIVATED,
            targetType: "RestaurantTable",
            targetId: existing.id,
            branchId: req.staff!.branchId,
            ipAddress: req.ip,
            metadata: { label: existing.label },
          });
        }

        if (req.body.active === true && !existing.active) {
          await recordAudit(tx, {
            actorId: req.staff!.staffId,
            action: AUDIT_ACTIONS.TABLE_ACTIVATED,
            targetType: "RestaurantTable",
            targetId: existing.id,
            branchId: req.staff!.branchId,
            ipAddress: req.ip,
            metadata: { label: updated.label },
          });
        }

        return updated;
      });

      res.json({ table });
    } catch (err) {
      next(err);
    }
  },
);
adminTableRouter.post("/tables/:id/qr/regenerate", requireTrustedOrigin, async (req, res, next) => {
  try {
    const rawQrToken = createOpaqueToken(32);
    const table = await prisma.$transaction(async (tx) => {
      const existing = await tx.restaurantTable.findFirst({
        where: { id: req.params.id, branchId: req.staff!.branchId },
        select: { id: true, label: true, qrVersion: true },
      });
      if (!existing) {
        const error = new Error("Table not found");
        (error as Error & { status?: number }).status = 404;
        throw error;
      }

      const updated = await tx.restaurantTable.update({
        where: { id: existing.id },
        data: { qrTokenHash: hashToken(rawQrToken), qrVersion: { increment: 1 } },
        select: { id: true, label: true, qrVersion: true },
      });
      await tx.tableSession.updateMany({
        where: { tableId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordAudit(tx, {
        actorId: req.staff!.staffId,
        action: AUDIT_ACTIONS.QR_REGENERATED,
        targetType: "RestaurantTable",
        targetId: updated.id,
        branchId: req.staff!.branchId,
        ipAddress: req.ip,
        metadata: { previousQrVersion: existing.qrVersion, qrVersion: updated.qrVersion },
      });
      return updated;
    });

    res.json({
      table,
      qrUrl: `${getConfig().appBaseUrl}/order?t=${encodeURIComponent(rawQrToken)}`,
      qrToken: rawQrToken,
      warning: "The previous QR is invalid immediately. Store or print this QR now.",
    });
  } catch (err) {
    next(err);
  }
});

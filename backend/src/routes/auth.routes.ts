import { Router } from "express";
import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { validateBody } from "../middleware/validate";
import { prisma } from "../lib/prisma";
import { getConfig } from "../config/env";
import { requireAdmin } from "../middleware/auth";
import { requireTrustedOrigin } from "../middleware/origin";
import { createOpaqueToken, hashToken } from "../security/tokens";
import { AUDIT_ACTIONS, recordAudit } from "../services/audit.service";

export const authRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
}).strict();

function staffCookieOptions() {
  const config = getConfig();
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
    maxAge: 8 * 60 * 60 * 1000,
  };
}

authRouter.post("/staff/login", requireTrustedOrigin, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const staff = await prisma.staff.findUnique({ where: { email } });

    if (!staff || !staff.active) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      return res.status(401).json({ error: "Account temporarily locked. Try again later." });
    }

    const valid = await bcrypt.compare(password, staff.passwordHash);
    if (!valid) {
      const attempts = staff.failedLoginAttempts + 1;
      // staff.lockedUntil is guaranteed null-or-expired here: an active lock
      // already returned 401 above before the password was ever checked. So
      // a lockedUntil computed below is always a *newly* triggered lockout.
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;
      await prisma.$transaction(async (tx) => {
        await tx.staff.update({
          where: { id: staff.id },
          data: { failedLoginAttempts: lockedUntil ? 0 : attempts, lockedUntil },
        });
        await recordAudit(tx, {
          actorId: staff.id,
          action: AUDIT_ACTIONS.STAFF_LOGIN_FAILED,
          targetType: "Staff",
          targetId: staff.id,
          branchId: staff.branchId,
          ipAddress: req.ip,
          metadata: { locked: Boolean(lockedUntil) },
        });
        if (lockedUntil) {
          await recordAudit(tx, {
            actorId: staff.id,
            action: AUDIT_ACTIONS.STAFF_ACCOUNT_LOCKED,
            targetType: "Staff",
            targetId: staff.id,
            branchId: staff.branchId,
            ipAddress: req.ip,
            metadata: { failedAttempts: attempts, lockedUntil: lockedUntil.toISOString() },
          });
        }
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const updated = await prisma.staff.update({
      where: { id: staff.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const config = getConfig();
    if (!config.jwtSecret) return res.status(503).json({ error: "Authentication is not configured" });

    const sessionId = createOpaqueToken(32);
    const token = jwt.sign(
      { staffId: updated.id, sessionVersion: updated.sessionVersion, sessionId },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"] },
    );

    await prisma.$transaction(async (tx) => {
      await tx.adminSession.create({
        data: {
          id: sessionId,
          staffId: updated.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
          userAgent: req.get("user-agent")?.slice(0, 500),
          ipAddress: req.ip,
        },
      });
      await recordAudit(tx, {
        actorId: updated.id,
        action: AUDIT_ACTIONS.STAFF_LOGIN_SUCCESS,
        targetType: "Staff",
        targetId: updated.id,
        branchId: updated.branchId,
        ipAddress: req.ip,
      });
    });

    res.cookie(config.cookieName, token, staffCookieOptions());
    res.json({ name: updated.name });
  } catch (err) {
    next(err);
  }
});

/**
 * The admin frontend's only way to learn "am I still logged in, and as
 * whom" — called on every load/mount (see admin/src/context/AuthContext.tsx)
 * so a session that expires or gets revoked mid-use (logout in another
 * tab, forced revoke-all, deactivation) is discovered immediately via a
 * 401, rather than the client ever deciding on its own that a stale
 * cookie is still good.
 *
 * requireAdmin has already fully re-verified the session against the DB
 * (see middleware/auth.ts) by the time this handler runs, so it only
 * needs to project the already-trusted identity down to customer/UI-safe
 * fields — no passwordHash, sessionVersion, or other internal column is
 * ever included.
 */
authRouter.get("/staff/me", requireAdmin, async (req, res, next) => {
  try {
    const staff = await prisma.staff.findUnique({
      where: { id: req.staff!.staffId },
      select: { id: true, name: true, email: true },
    });
    // requireAdmin already confirmed this staff row exists, is active, and
    // matches the current sessionVersion — a miss here would mean the
    // account was deleted in the instant between those two checks. Treat
    // it the same as "not authenticated" rather than a 500.
    if (!staff) return res.status(401).json({ error: "Not authenticated" });
    res.json(staff);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/staff/logout", requireTrustedOrigin, async (req, res, next) => {
  try {
    if (req.staff) {
      const staff = req.staff;
      await prisma.$transaction(async (tx) => {
        await tx.adminSession.updateMany({
          where: { id: staff.sessionId, staffId: staff.staffId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await recordAudit(tx, {
          actorId: staff.staffId,
          action: AUDIT_ACTIONS.STAFF_LOGOUT,
          targetType: "AdminSession",
          targetId: staff.sessionId,
          branchId: staff.branchId,
          ipAddress: req.ip,
        });
      });
    }
    const config = getConfig();
    res.clearCookie(config.cookieName, config.cookieDomain ? { domain: config.cookieDomain } : {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/staff/revoke-all", requireAdmin, requireTrustedOrigin, async (req, res, next) => {
  try {
    const staff = req.staff!;
    await prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: staff.staffId },
        data: { sessionVersion: { increment: 1 } },
      });
      const revoked = await tx.adminSession.updateMany({
        where: { staffId: staff.staffId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordAudit(tx, {
        actorId: staff.staffId,
        action: AUDIT_ACTIONS.STAFF_SESSIONS_REVOKED,
        targetType: "Staff",
        targetId: staff.staffId,
        branchId: staff.branchId,
        ipAddress: req.ip,
        metadata: { revokedCount: revoked.count },
      });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

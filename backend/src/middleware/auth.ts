import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { getConfig } from "../config/env";
import { hashToken } from "../security/tokens";

/**
 * ADMIN is the only authenticated operational user in this system. Every
 * staff route uses requireAdmin.
 */
export interface AuthenticatedStaff {
  staffId: string;
  branchId: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: AuthenticatedStaff;
    }
  }
}

/** Result of a fully re-verified ADMIN session, safe to trust for the rest of a request/connection. */
export interface VerifiedAdminSession {
  staffId: string;
  branchId: string;
  sessionId: string;
  sessionVersion: number;
}

/**
 * The single source of truth for turning a raw session-cookie token into a
 * trusted, DB-backed identity. Used by both the HTTP `attachStaff`
 * middleware and the Socket.IO auth middleware so the two transports can
 * never drift apart or accept a session the other would reject.
 *
 * Re-verifies against the database on every call (never trusts the JWT
 * claims alone):
 *   - active must still be true (deactivation takes effect immediately,
 *     not just at token expiry)
 *   - sessionVersion must still match (a logout — or an admin forcing a
 *     revoke — invalidates the token immediately even though the JWT
 *     itself hasn't expired)
 *   - the AdminSession row must exist, be unrevoked, unexpired, and match
 *     this exact token's hash
 *   - role, branchId are read fresh from the DB, never trusted from the
 *     token, so a branch reassignment also takes effect immediately.
 *
 * Never throws — any failure (malformed token, expired JWT, DB mismatch,
 * transient DB error) resolves to `null` so callers can fail closed without
 * leaking why verification failed.
 */
export async function verifyAdminSessionToken(token: string | undefined | null): Promise<VerifiedAdminSession | null> {
  if (!token) return null;
  try {
    const config = getConfig();
    if (!config.jwtSecret) return null;
    const payload = jwt.verify(token, config.jwtSecret);
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload.staffId !== "string" ||
      typeof payload.sessionId !== "string" ||
      typeof payload.sessionVersion !== "number"
    ) {
      return null;
    }

    const staff = await prisma.staff.findUnique({
      where: { id: payload.staffId },
      select: { id: true, branchId: true, active: true, role: true, sessionVersion: true },
    });
    const session = await prisma.adminSession.findFirst({
      where: {
        id: payload.sessionId,
        staffId: payload.staffId,
        tokenHash: hashToken(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (
      !staff ||
      !session ||
      !staff.active ||
      staff.role !== "ADMIN" ||
      staff.sessionVersion !== payload.sessionVersion
    ) {
      // Any mismatch (deactivated, revoked session, role changed, stale
      // sessionVersion) — treat as unauthenticated.
      return null;
    }

    return {
      staffId: staff.id,
      branchId: staff.branchId,
      sessionId: session.id,
      sessionVersion: staff.sessionVersion,
    };
  } catch {
    // invalid/expired/malformed token, or a transient DB error — treat as
    // unauthenticated rather than throwing.
    return null;
  }
}

/**
 * Reads the HttpOnly session cookie (never a header/localStorage token) and,
 * if it verifies, attaches the trusted staff identity to the request.
 *
 * Does NOT reject unauthenticated requests by itself — combine with
 * requireAdmin() on routes that need it.
 */
export async function attachStaff(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[getConfig().cookieName];
  const verified = await verifyAdminSessionToken(token);
  if (verified) {
    req.staff = { staffId: verified.staffId, branchId: verified.branchId, sessionId: verified.sessionId };
    try {
      await prisma.adminSession.update({
        where: { id: verified.sessionId },
        data: { lastSeenAt: new Date() },
      });
    } catch {
      // Best-effort activity tracking only — never fail the request over it.
    }
  }
  next();
}

/** Rejects the request unless it carries a live, verified ADMIN session. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.staff) return res.status(401).json({ error: "Not authenticated" });
  next();
}

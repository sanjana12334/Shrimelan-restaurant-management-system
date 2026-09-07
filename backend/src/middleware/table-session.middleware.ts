import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { getConfig } from "../config/env";
import { resolveActiveTableSession, touchTableSession } from "../services/table-session.service";

export interface CustomerTableSession {
  id: string;
  tableId: string;
  branchId: string;
  qrVersion: number;
  expiresAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      tableSession?: CustomerTableSession;
    }
  }
}

/**
 * Reads the HttpOnly table-session cookie and, if it verifies against the
 * database, attaches the trusted session to the request. All validation
 * logic (revocation, expiry, active table, QR-version match, branch match)
 * lives in `services/table-session.service.ts`, re-checked on every call —
 * never trusted from anything cached or client-supplied.
 *
 * Does NOT reject unauthenticated requests by itself — combine with
 * requireTableSession() on routes that need it.
 */
export async function attachTableSession(req: Request, _res: Response, next: NextFunction) {
  const rawToken = req.cookies?.[getConfig().sessionCookieName];
  try {
    const session = await resolveActiveTableSession(prisma, rawToken);
    if (session) {
      req.tableSession = session;
      await touchTableSession(prisma, session.id);
    }
  } catch {
    // Invalid customer credentials are treated as anonymous, never as a 500.
  }
  next();
}

export function requireTableSession(req: Request, res: Response, next: NextFunction) {
  if (!req.tableSession) return res.status(401).json({ error: "Valid table session required" });
  next();
}

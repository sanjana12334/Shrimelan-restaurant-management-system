import { Request, Response, NextFunction } from "express";
import { allowedOrigins, getConfig } from "../config/env";

function requestOrigin(req: Request): string | null {
  const origin = req.get("origin");
  if (origin) return origin;
  const referer = req.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Cookie-authenticated writes must come from one of the configured browser
 * origins. In production, a missing Origin/Referer is rejected to prevent
 * cross-site form submissions that omit CORS preflight.
 */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  const config = getConfig();
  const origin = requestOrigin(req);
  if (!origin) {
    if (!config.isProduction) return next();
    return res.status(403).json({ error: "Origin required" });
  }
  if (!allowedOrigins().includes(origin)) {
    return res.status(403).json({ error: "Untrusted request origin" });
  }
  if (req.get("sec-fetch-site") === "cross-site") {
    return res.status(403).json({ error: "Cross-site request rejected" });
  }
  next();
}

import "dotenv/config";
import express from "express";
import http from "http";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { adminMenuRouter } from "./routes/admin-menu.routes";
import { getConfig, validateEnvironment } from "./config/env";
import { attachStaff } from "./middleware/auth";
import { menuRouter } from "./routes/menu.routes";
import { orderRouter } from "./routes/order.routes";
import { authRouter } from "./routes/auth.routes";
import { staffOrderRouter } from "./routes/staff-orders.routes";
import { adminTableRouter, publicTableRouter } from "./routes/table.routes";
import { auditLogRouter } from "./routes/audit-log.routes";
import { initIO } from "./sockets/io";
import { adminStaffRouter } from "./routes/admin-staff.routes";

validateEnvironment();
const config = getConfig();
const app = express();
const httpServer = http.createServer(app);

// ---------- Core hardening ----------
app.set("trust proxy", 1); // behind Cloudflare/Railway proxy
// This server only ever returns JSON — it never serves HTML, scripts, or
// styles — so the default helmet CSP (default-src 'self', etc.) is loosened
// further than this API needs. Locking every directive to 'none' gives a
// defense-in-depth guarantee that even a future accidental HTML/error
// response can't be abused for XSS or clickjacking-style framing.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    frameguard: { action: "deny" },
  })
);
// Helmet does not set Permissions-Policy itself; this API doesn't use any
// browser feature, so every capability is explicitly disabled.
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
  );
  next();
});
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(Object.assign(new Error("Origin is not allowed"), { status: 403 }));
    },
    credentials: true,
  })
);
// No route reads req.query, so the extended ('qs') parser's recursive
// bracket-object parsing is pure unused attack surface (see CVE advisories
// for `qs`, pulled in transitively via express/body-parser). The 'simple'
// parser (Node's built-in querystring) has no such recursion.
app.set("query parser", "simple");
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(pinoHttp({
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['set-cookie']",
      "res.headers['set-cookie']",
    ],
    censor: "[REDACTED]",
  },
}));
app.use(attachStaff);

// ---------- Rate limiting ----------
const publicLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxPublic,
  standardHeaders: true,
  legacyHeaders: false,
});
const orderCreateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxOrderCreate,
});
const tableSessionLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxTableSession,
});
const orderTrackingLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxOrderTracking,
});
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const sensitiveAdminLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxAdmin,
});

// ---------- Public customer API ----------
app.use("/api/public", publicLimiter);
app.use("/api/public/table-session", tableSessionLimiter, publicTableRouter);
app.use("/api/public/orders", orderCreateLimiter);
app.use("/api/public/orders/:orderNumber", orderTrackingLimiter);
app.use("/api/public", menuRouter);
app.use("/api/public", orderRouter);

// ---------- Auth ----------
app.use("/api/auth", loginLimiter, authRouter);

// ---------- Staff API (RBAC enforced per-route, see staff-orders.routes.ts) ----------
app.use("/api", sensitiveAdminLimiter, staffOrderRouter);
app.use("/api/admin", sensitiveAdminLimiter, adminTableRouter);
app.use("/api/admin", sensitiveAdminLimiter, adminMenuRouter);
app.use("/api/admin", sensitiveAdminLimiter, adminStaffRouter);
app.use("/api/admin", sensitiveAdminLimiter, auditLogRouter);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---------- Central error handler (never leak stack traces to clients) ----------
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log?.error(
    { error: { name: err?.name, message: err?.message, status: err?.status } },
    "request failed",
  );
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
});

initIO(httpServer);

httpServer.listen(config.port, () => console.log(`ShriMelan API listening on :${config.port}`));

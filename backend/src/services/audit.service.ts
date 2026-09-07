import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Centralized audit logging.
 *
 * Every write to the AuditLog table MUST go through `recordAudit()` in this
 * file — never `prisma.auditLog.create(...)` directly from a route. That is
 * what guarantees, everywhere in the app, that:
 *
 *   1. `action` is one of a fixed, documented catalogue (`AUDIT_ACTIONS`),
 *      not a free-form string a route author can typo or invent.
 *   2. `metadata` is recursively scrubbed of anything that looks like a
 *      credential/token/secret before it is persisted, even if a caller
 *      passes one in by mistake (see SECURITY RULE below).
 *   3. Every event has the same shape — actor, action, target, branch,
 *      timestamp, metadata — so it can be queried/rendered generically.
 *
 * SECURITY RULE — NEVER put into `metadata` (or any other field):
 *   passwords, JWTs, cookies, QR secrets, session tokens, order access
 *   tokens, database URLs, API keys, or raw authentication headers.
 * Log a safe reference instead: an ID, an hashed-token's own DB row id, a
 * count, an enum value, a previous/next pair of non-secret fields. The
 * sanitizer below is a backstop against mistakes, not a license to pass
 * secrets through — the caller is the primary control.
 */

// ---------------------------------------------------------------------------
// Action catalogue
// ---------------------------------------------------------------------------

/**
 * Every action this app can currently emit, grouped as requested. A few
 * actions are marked "reserved": the feature that would trigger them
 * (admin management, menu management, order edits, table activation) has no
 * route yet, so nothing calls recordAudit() with them today. They're listed
 * here anyway so that whoever builds that route later logs under a fixed,
 * pre-agreed name instead of inventing a new one.
 */
export const AUDIT_ACTIONS = {
  // ---- AUTH ---------------------------------------------------------------
  STAFF_LOGIN_SUCCESS: "STAFF_LOGIN_SUCCESS",
  STAFF_LOGIN_FAILED: "STAFF_LOGIN_FAILED",
  STAFF_ACCOUNT_LOCKED: "STAFF_ACCOUNT_LOCKED",
  STAFF_LOGOUT: "STAFF_LOGOUT",
  STAFF_SESSIONS_REVOKED: "STAFF_SESSIONS_REVOKED",

  // ---- ADMIN MANAGEMENT (reserved — no admin-management route exists yet) -
  ADMIN_CREATED: "ADMIN_CREATED",
  ADMIN_DISABLED: "ADMIN_DISABLED",
  ADMIN_ENABLED: "ADMIN_ENABLED",
  ADMIN_PASSWORD_CHANGED: "ADMIN_PASSWORD_CHANGED",
  ADMIN_SECURITY_CHANGED: "ADMIN_SECURITY_CHANGED",
  ADMIN_SESSION_REVOKED: "ADMIN_SESSION_REVOKED",

  // ---- ORDERS ---------------------------------------------------------------
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  ORDER_MODIFIED_BY_ADMIN: "ORDER_MODIFIED_BY_ADMIN", // reserved — no order-edit route yet

  // ---- PAYMENTS ---------------------------------------------------------------
  // ShriMelan has no online payment gateway: an ADMIN records counter
  // payment after the fact, and the method is captured at that exact
  // moment, so both "marked paid" and "payment method recorded" are one
  // event today. PAYMENT_METHOD_RECORDED is reserved for a future flow
  // where the method could be recorded independently of marking paid.
  PAYMENT_MARKED_PAID: "PAYMENT_MARKED_PAID",
  PAYMENT_METHOD_RECORDED: "PAYMENT_METHOD_RECORDED", // reserved

  // ---- MENU (reserved — no admin menu-management route exists yet) --------
  MENU_CATEGORY_CREATED: "MENU_CATEGORY_CREATED",
  MENU_CATEGORY_UPDATED: "MENU_CATEGORY_UPDATED",
  MENU_CATEGORY_DELETED: "MENU_CATEGORY_DELETED",
  MENU_ITEM_CREATED: "MENU_ITEM_CREATED",
  MENU_ITEM_UPDATED: "MENU_ITEM_UPDATED",
  MENU_ITEM_DELETED: "MENU_ITEM_DELETED",
  MENU_ITEM_PRICE_CHANGED: "MENU_ITEM_PRICE_CHANGED",
  MENU_ITEM_AVAILABILITY_CHANGED: "MENU_ITEM_AVAILABILITY_CHANGED",

  // ---- TABLES / QR ---------------------------------------------------------
  TABLE_CREATED: "TABLE_CREATED",
  TABLE_ACTIVATED: "TABLE_ACTIVATED", // reserved — no table-activation route yet
  TABLE_DEACTIVATED: "TABLE_DEACTIVATED", // reserved
  QR_GENERATED: "QR_GENERATED",
  QR_REGENERATED: "QR_REGENERATED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditTargetType =
  | "Staff"
  | "AdminSession"
  | "Order"
  | "MenuCategory"
  | "MenuItem"
  | "RestaurantTable";

// ---------------------------------------------------------------------------
// Metadata sanitization
// ---------------------------------------------------------------------------

// Matches KEY NAMES (not values), case-insensitively and against
// snake_case/camelCase/kebab-case alike, so a route author doesn't have to
// remember an exact spelling convention for it to be caught.
const FORBIDDEN_KEY_PATTERN =
  /password|passwd|jwt|cookie|secret|token|api[-_]?key|authoriz|auth[-_]?header|database[-_]?url|db[-_]?url|connection[-_]?string|private[-_]?key/i;

const REDACTED = "[REDACTED]";
const MAX_METADATA_DEPTH = 4;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 50;

/**
 * Recursively strips anything that looks like a credential/secret out of a
 * metadata value before it is persisted, and caps string length / array
 * length / nesting depth so a caller can't accidentally dump an entire
 * request body (or something equally unbounded) into the audit table.
 *
 * This is a backstop, not a substitute for callers only ever passing safe,
 * minimal metadata — IDs, enum values, counts, previous/next value pairs.
 */
export function sanitizeAuditMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= MAX_METADATA_DEPTH) return "[TRUNCATED]";

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeAuditMetadata(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = FORBIDDEN_KEY_PATTERN.test(key) ? REDACTED : sanitizeAuditMetadata(val, depth + 1);
    }
    return result;
  }

  // bigint, function, symbol, etc. — never persist a shape we don't recognize.
  return "[UNSUPPORTED]";
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Anything that can run `.auditLog.create` — the shared `prisma` client, or
 * the `tx` argument inside an active `prisma.$transaction(async (tx) => …)`.
 */
export type AuditCapableClient = Pick<PrismaClient, "auditLog"> | Prisma.TransactionClient;

export interface AuditEvent {
  /** Staff who performed the action. Omit/null when there is no authenticated actor (e.g. a customer placing an order). */
  actorId?: string | null;
  action: AuditAction;
  targetType?: AuditTargetType | null;
  targetId?: string | null;
  /** Branch the action relates to. Omit/null only when there truly is none (e.g. a login attempt for an email that matches no account is never logged at all, not attached here). */
  branchId?: string | null;
  ipAddress?: string | null;
  /** Safe, minimal facts only — see sanitizeAuditMetadata. Never pass a raw request body, header set, or full entity row. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Writes one audit event.
 *
 * Pass the `tx` from an active `prisma.$transaction(async (tx) => …)` when
 * the audit record must be committed atomically with the operation it
 * describes — that's every sensitive write this service is wired into today
 * (login, logout, session revocation, order status/payment changes, table
 * and QR changes) — and the bare `prisma` client only when there genuinely
 * is no surrounding transaction.
 *
 * Metadata is sanitized before it is written; everything else is written
 * as given. A database error (e.g. the DB is unreachable) propagates to the
 * caller so that, inside a transaction, the whole operation rolls back
 * rather than silently completing without its audit trail.
 */
export async function recordAudit(client: AuditCapableClient, event: AuditEvent): Promise<void> {
  const data = {
    staffId: event.actorId ?? null,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    branchId: event.branchId ?? null,
    ipAddress: event.ipAddress ?? null,
    metadata: event.metadata == null ? undefined : (sanitizeAuditMetadata(event.metadata) as Prisma.InputJsonValue),
  };
  // `branchId` was added to the AuditLog model in the same change as this
  // service. The cast is removable once `npx prisma generate` has been run
  // against this schema — see prisma/migrations/20260906030000_audit_log_branch.
  await client.auditLog.create({ data: data as unknown as Prisma.AuditLogUncheckedCreateInput });
}

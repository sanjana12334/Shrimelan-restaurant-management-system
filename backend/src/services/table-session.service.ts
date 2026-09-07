import { Prisma, PrismaClient } from "@prisma/client";
import { createOpaqueToken, hashToken } from "../security/tokens";

/**
 * Centralized customer QR-entry / table-session logic.
 *
 * This file is the ONLY place allowed to decide whether a QR credential is
 * valid, mint a TableSession, or decide whether an existing TableSession is
 * still active. `middleware/table-session.ts` (HTTP) and `routes/table.
 * routes.ts` (the public QR-entry endpoints) both call into this file
 * rather than querying `RestaurantTable` / `TableSession` directly, so the
 * security properties below live in one auditable, unit-testable place.
 *
 * Rules encoded here:
 *   1. The QR credential is a >=256-bit cryptographically random opaque
 *      token (`createOpaqueToken`), never the table's own id and never the
 *      branch's id — knowing/guessing a database id must never be
 *      sufficient to mint a table session.
 *   2. Only a SHA-256 hash of the QR credential (`qrTokenHash`) and of the
 *      session credential (`sessionTokenHash`) are ever persisted; the raw
 *      values exist only in memory for the single response that issues
 *      them (a redirect URL for the printed QR, an HttpOnly cookie for the
 *      session) and are never logged, audited, or stored.
 *   3. `resolveTableFromQrCredential` and `resolveActiveTableSession` never
 *      distinguish "wrong/unknown credential" from "credential valid but
 *      table/session inactive" in their result — both fail identically, so
 *      a customer (or attacker) probing tokens learns nothing about
 *      whether a table exists or is merely deactivated.
 *   4. A TableSession is only ever considered active when its stored
 *      `qrVersion` still matches the table's *current* `qrVersion` — QR
 *      regeneration (which bumps `qrVersion` and explicitly revokes every
 *      session for that table) and this version check are independent,
 *      overlapping controls, so even a session row that somehow escaped
 *      explicit revocation is still rejected once the QR has moved on.
 *   5. `branchId` on a TableSession is fixed at creation from the table's
 *      own branch and is never taken from client input anywhere — the
 *      cross-check against the table's current `branchId` in
 *      `resolveActiveTableSession` is defense-in-depth against data drift,
 *      not a trust boundary a client can influence.
 *   6. Sessions are never bound to an IP address — `TableSession` has no
 *      IP column, and nothing in this file reads or stores one — so a
 *      customer's session survives ordinary network changes (e.g. wifi to
 *      cellular) without weakening anything, since the opaque token itself
 *      is the only credential that matters.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Safe, client-facing error for QR/table-session failures. `message` is
 * always safe to return verbatim (never a stack trace or internal detail),
 * and is deliberately the *same* generic string for every distinct failure
 * reason (unknown token, inactive table) so a client can't distinguish them.
 */
export class TableSessionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TableSessionError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A table resolved from a valid QR credential. Internal id is present for
 * server-side use only (creating the session) — never return this object
 * directly to a customer response. */
export interface ResolvedTable {
  id: string;
  branchId: string;
  label: string;
  qrVersion: number;
}

/** Result of minting a new TableSession. `rawSessionToken` must be placed
 * only in an HttpOnly cookie — never in a JSON body, log line, or audit
 * metadata field. */
export interface CreatedTableSession {
  id: string;
  tableId: string;
  branchId: string;
  tableLabel: string;
  rawSessionToken: string;
  expiresAt: Date;
}

/** A currently-active, fully-reverified TableSession, safe to trust for the
 * rest of a request. Contains no field a customer's request body could have
 * influenced. */
export interface ActiveTableSession {
  id: string;
  tableId: string;
  branchId: string;
  qrVersion: number;
  expiresAt: Date;
}

type PrismaLike = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// QR validation
// ---------------------------------------------------------------------------

/**
 * Validates a raw QR credential (scanned from the printed code) against the
 * stored hash and returns the table it identifies.
 *
 * Never trusts a tableId/branchId supplied by the client — the *only* input
 * is the opaque QR token itself, and the table/branch are looked up from
 * it. An unknown token and a token belonging to a deactivated table are
 * rejected with the exact same generic error, so a caller can never use
 * this to enumerate which QR codes exist versus which are merely inactive.
 */
export async function resolveTableFromQrCredential(
  prisma: PrismaLike,
  rawQrToken: string,
): Promise<ResolvedTable> {
  const table = await prisma.restaurantTable.findUnique({
    where: { qrTokenHash: hashToken(rawQrToken) },
    select: { id: true, branchId: true, label: true, active: true, qrVersion: true },
  });
  if (!table || !table.active) {
    throw new TableSessionError("Invalid table QR", 404);
  }
  return { id: table.id, branchId: table.branchId, label: table.label, qrVersion: table.qrVersion };
}

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

/**
 * Mints a new TableSession for a table already resolved from a valid QR
 * credential. The session is stamped with the table's *current* qrVersion
 * at creation time, so a later QR regeneration is detectable purely by
 * comparing this stored value against the table's current one.
 *
 * `ttlMs` controls how long the session is valid; callers pass the
 * server-configured TTL — never anything from client input.
 */
export async function createTableSession(
  prisma: PrismaLike,
  table: ResolvedTable,
  ttlMs: number,
): Promise<CreatedTableSession> {
  const rawSessionToken = createOpaqueToken(32);
  const expiresAt = new Date(Date.now() + ttlMs);
  const session = await prisma.tableSession.create({
    data: {
      tableId: table.id,
      branchId: table.branchId,
      sessionTokenHash: hashToken(rawSessionToken),
      qrVersion: table.qrVersion,
      expiresAt,
    },
    select: { id: true },
  });
  return {
    id: session.id,
    tableId: table.id,
    branchId: table.branchId,
    tableLabel: table.label,
    rawSessionToken,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a raw table-session cookie value into a trusted, DB-backed
 * session, re-verified against the database on every call:
 *   - the session row must exist, be unrevoked, and unexpired
 *   - the table it references must still be active
 *   - the session's stored qrVersion must still equal the table's current
 *     qrVersion (rejects sessions minted against an old, regenerated QR)
 *   - the session's branchId must still equal the table's current branchId
 *
 * Returns `null` on any failure — never throws — so HTTP/socket callers can
 * fail closed (treat the request as having no valid session) without
 * leaking which specific check failed.
 */
export async function resolveActiveTableSession(
  prisma: PrismaLike,
  rawSessionToken: string | undefined | null,
): Promise<ActiveTableSession | null> {
  if (!rawSessionToken) return null;
  const session = await prisma.tableSession.findFirst({
    where: {
      sessionTokenHash: hashToken(rawSessionToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
      table: { active: true },
    },
    select: {
      id: true,
      tableId: true,
      branchId: true,
      qrVersion: true,
      expiresAt: true,
      table: { select: { qrVersion: true, branchId: true } },
    },
  });
  if (!session) return null;
  // Old-QR rejection: a session stamped with a qrVersion the table has
  // since moved past (via regeneration) is never active, independent of
  // whether its row was also explicitly revoked.
  if (session.qrVersion !== session.table.qrVersion) return null;
  // Defense-in-depth: branchId is set once at creation and never updated
  // independently of the table's own branchId, so this should never
  // actually diverge — but if it ever did, fail closed rather than trust
  // the (potentially stale) value stored on the session row.
  if (session.branchId !== session.table.branchId) return null;

  return {
    id: session.id,
    tableId: session.tableId,
    branchId: session.branchId,
    qrVersion: session.qrVersion,
    expiresAt: session.expiresAt,
  };
}

/**
 * Best-effort activity timestamp bump. Never throws — a failure here must
 * never fail the customer's request.
 */
export async function touchTableSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  try {
    await prisma.tableSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
  } catch {
    // Best-effort activity tracking only.
  }
}

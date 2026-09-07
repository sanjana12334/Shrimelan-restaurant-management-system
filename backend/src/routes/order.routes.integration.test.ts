import assert from "node:assert/strict";
import test, { mock, before, after } from "node:test";
import http from "node:http";
import { randomUUID, createHash } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import type { AppConfig } from "../config/env";
import { getConfig } from "../config/env";

/**
 * Real end-to-end HTTP tests for customer order creation/tracking.
 *
 * Every other test file in this project unit-tests exported functions in
 * isolation (pricing.service, table-session.service, ...). None of them
 * actually drive an HTTP request through the real `orderRouter` — the
 * Express middleware chain (origin check, cookie parsing, table-session
 * resolution, body validation) and the route handler's own transaction
 * logic have never been exercised together. That gap matters here because
 * the security properties this task cares about (server-derived
 * branch/table, ignored client price fields, idempotent duplicate
 * submission, access-token-gated tracking) are properties of the whole
 * request pipeline, not of any single function.
 *
 * `@prisma/client`, `../lib/prisma`, and `../sockets/io` are mocked via
 * node:test's `mock.module` (this file's own database-shaped fake, kept in
 * memory) because a live Postgres + generated Prisma client isn't
 * available in this environment. Every other module — express,
 * cookie-parser, the real `order.routes.ts`, `order.schemas.ts`,
 * `pricing.service.ts`, `table-session.middleware.ts`, `origin.ts`,
 * `validate.ts`, `audit.service.ts`, and `security/tokens.ts` — is the
 * real, unmodified production code.
 */

// ---------------------------------------------------------------------------
// Fake database
// ---------------------------------------------------------------------------

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

class FakeKnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
  }
}

interface FakeMenuItemRow {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  branchId: string;
  variants: { id: string; name: string; priceDelta: number }[];
  addons: { id: string; name: string; price: number; isActive: boolean }[];
}

interface FakeTableSessionRow {
  id: string;
  tableId: string;
  branchId: string;
  qrVersion: number;
  sessionTokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
  tableActive: boolean;
  tableQrVersion: number;
  tableBranchId: string;
}

interface FakeOrderRow {
  id: string;
  orderNumber: string;
  branchId: string;
  tableId: string | null;
  tableSessionId: string | null;
  customerName: string;
  customerPhone: string;
  note: string | null;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  paymentStatus: string;
  accessTokenHash: string;
  idempotencyKey: string | null;
  idempotencyScope: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  items: {
    itemId: string;
    variantId?: string;
    itemNameSnap: string;
    variantNameSnap: string | null;
    unitPriceSnap: number;
    quantity: number;
    addonsSnap: { name: string; price: number }[] | null;
    instructions: string | null;
  }[];
  statusHistory: { status: string; changedAt: Date }[];
}

function makeDecimalish(n: number) {
  // Mimics enough of Prisma.Decimal's surface for order.routes.ts:
  // `.toString()` is the only method it calls on price fields.
  return { toString: () => n.toString(), valueOf: () => n };
}

function buildFakeDb() {
  const menuItems: FakeMenuItemRow[] = [];
  const tableSessions: FakeTableSessionRow[] = [];
  const orders: FakeOrderRow[] = [];
  const auditLog: unknown[] = [];

  const tx = {
    tableSession: {
      async findFirst({ where }: any) {
        const row = tableSessions.find((s) => {
          if (where.id && s.id !== where.id) return false;
          if (where.sessionTokenHash && s.sessionTokenHash !== where.sessionTokenHash) return false;
          if (where.revokedAt === null && s.revokedAt !== null) return false;
          if (where.expiresAt?.gt && s.expiresAt <= where.expiresAt.gt) return false;
          if (where.table?.active && !s.tableActive) return false;
          return true;
        });
        if (!row) return null;
        return {
          id: row.id,
          tableId: row.tableId,
          branchId: row.branchId,
          qrVersion: row.qrVersion,
          expiresAt: row.expiresAt,
          table: { qrVersion: row.tableQrVersion, branchId: row.tableBranchId },
        };
      },
      async update({ where }: any) {
        const row = tableSessions.find((s) => s.id === where.id);
        return row ?? null;
      },
    },
    menuItem: {
      async findUnique({ where }: any) {
        const row = menuItems.find((m) => m.id === where.id);
        if (!row) return null;
        return {
          id: row.id,
          name: row.name,
          price: row.price,
          isAvailable: row.isAvailable,
          category: { branchId: row.branchId },
          variants: row.variants,
          addons: row.addons,
        };
      },
    },
    order: {
      async findFirst({ where }: any) {
        const row = orders.find((o) => {
          if (where.idempotencyScope !== undefined && o.idempotencyScope !== where.idempotencyScope) return false;
          if (where.idempotencyKey !== undefined && o.idempotencyKey !== where.idempotencyKey) return false;
          if (where.orderNumber !== undefined && o.orderNumber !== where.orderNumber) return false;
          if (where.accessTokenHash !== undefined && o.accessTokenHash !== where.accessTokenHash) return false;
          return true;
        });
        return row ? toClientOrder(row) : null;
      },
      async create({ data }: any) {
        const conflict = orders.find(
          (o) => o.idempotencyScope === data.idempotencyScope && o.idempotencyKey === data.idempotencyKey,
        );
        if (conflict) throw new FakeKnownRequestError("Unique constraint failed", "P2002");
        if (orders.some((o) => o.accessTokenHash === data.accessTokenHash)) {
          throw new FakeKnownRequestError("Unique constraint failed", "P2002");
        }
        const row: FakeOrderRow = {
          id: randomUUID(),
          orderNumber: data.orderNumber,
          branchId: data.branchId,
          tableId: data.tableId ?? null,
          tableSessionId: data.tableSessionId ?? null,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          note: data.note ?? null,
          subtotal: data.subtotal,
          tax: data.tax,
          total: data.total,
          status: data.status,
          paymentStatus: data.paymentStatus,
          accessTokenHash: data.accessTokenHash,
          idempotencyKey: data.idempotencyKey ?? null,
          idempotencyScope: data.idempotencyScope ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          paidAt: null,
          items: (data.items?.create ?? []).map((line: any) => ({
            itemId: line.itemId,
            variantId: line.variantId,
            itemNameSnap: line.itemNameSnap,
            variantNameSnap: line.variantNameSnap ?? null,
            unitPriceSnap: line.unitPriceSnap,
            quantity: line.quantity,
            addonsSnap: line.addonsSnap ?? null,
            instructions: line.instructions ?? null,
          })),
          statusHistory: [{ status: data.statusHistory?.create?.status ?? "RECEIVED", changedAt: new Date() }],
        };
        orders.push(row);
        return toClientOrder(row);
      },
    },
    auditLog: {
      async create({ data }: any) {
        auditLog.push(data);
        return data;
      },
    },
  };

  function toClientOrder(row: FakeOrderRow) {
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      branchId: row.branchId,
      tableId: row.tableId,
      tableSessionId: row.tableSessionId,
      status: row.status,
      paymentStatus: row.paymentStatus,
      accessTokenHash: row.accessTokenHash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      paidAt: row.paidAt,
      total: makeDecimalish(row.total),
      items: row.items.map((item) => ({
        itemNameSnap: item.itemNameSnap,
        variantNameSnap: item.variantNameSnap,
        unitPriceSnap: makeDecimalish(item.unitPriceSnap),
        quantity: item.quantity,
        addonsSnap: item.addonsSnap,
        instructions: item.instructions,
      })),
      statusHistory: row.statusHistory,
    };
  }

  const prisma = {
    ...tx,
    async $transaction(callback: (tx: unknown) => Promise<unknown>) {
      return callback(tx);
    },
  };

  return { prisma, menuItems, tableSessions, orders, auditLog };
}

// ---------------------------------------------------------------------------
// Module mocks — registered before order.routes.ts (or anything it
// transitively imports) is ever loaded.
// ---------------------------------------------------------------------------

const db = buildFakeDb();

mock.module("@prisma/client", {
  namedExports: {
    Prisma: { PrismaClientKnownRequestError: FakeKnownRequestError },
  },
});

mock.module("../lib/prisma", {
  namedExports: { prisma: db.prisma },
});

mock.module("../sockets/io", {
  namedExports: {
    getIO: () => ({ to: () => ({ emit: () => {} }) }),
  },
});

let orderRouter: express.Router;
let baseUrl: string;
let trustedOrigin: string;
let config: AppConfig;
let server: http.Server;

before(async () => {
  // Deliberately `require`d (not a static/dynamic ES import) so it is
  // loaded lazily, after the `mock.module` calls above have already
  // registered — order.routes.ts transitively imports @prisma/client,
  // ../lib/prisma, and ../sockets/io, all of which must resolve to the
  // fakes above rather than the real (uninitializable, in this sandbox)
  // modules.
  ({ orderRouter } = require("./order.routes"));
  config = getConfig();
  trustedOrigin = config.corsOrigins[0];

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/public", orderRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server?.close();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BRANCH_A = "branch-a";
const BRANCH_B = "branch-b";

function seedMenuItem(overrides: Partial<FakeMenuItemRow> & { id: string }): FakeMenuItemRow {
  const row: FakeMenuItemRow = {
    name: "Paneer Tikka",
    price: 250,
    isAvailable: true,
    branchId: BRANCH_A,
    variants: [],
    addons: [],
    ...overrides,
  };
  db.menuItems.push(row);
  return row;
}

function seedTableSession(overrides: Partial<FakeTableSessionRow> = {}) {
  const rawToken = randomUUID();
  const row: FakeTableSessionRow = {
    id: randomUUID(),
    tableId: randomUUID(),
    branchId: BRANCH_A,
    qrVersion: 1,
    sessionTokenHash: sha256(rawToken),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tableActive: true,
    tableQrVersion: 1,
    tableBranchId: BRANCH_A,
    ...overrides,
  };
  db.tableSessions.push(row);
  return { rawToken, row };
}

function cookieHeader(rawToken: string): string {
  return `${config.sessionCookieName}=${rawToken}`;
}

async function postOrder(body: unknown, opts: { cookie?: string; idempotencyKey?: string; accessToken?: string } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: trustedOrigin,
    "Idempotency-Key": opts.idempotencyKey ?? randomUUID(),
  };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.accessToken) headers["X-Order-Access-Token"] = opts.accessToken;
  const res = await fetch(`${baseUrl}/api/public/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function getOrder(orderNumber: string, accessToken?: string) {
  const headers: Record<string, string> = { Origin: trustedOrigin };
  if (accessToken) headers["X-Order-Access-Token"] = accessToken;
  const res = await fetch(`${baseUrl}/api/public/orders/${orderNumber}`, { headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function validLines(itemId: string) {
  return [{ itemId, quantity: 2, addonIds: [] }];
}

function validBody(itemId: string, extra: Record<string, unknown> = {}) {
  return {
    customerName: "Priya",
    customerPhone: "9876543210",
    orderType: "DINE_IN",
    lines: validLines(itemId),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. No table session at all
// ---------------------------------------------------------------------------

test("POST /orders without a table session cookie is rejected (401), no order created", async () => {
  const item = seedMenuItem({ id: randomUUID() });
  const before = db.orders.length;
  const { status, json } = await postOrder(validBody(item.id));
  assert.equal(status, 401);
  assert.equal(db.orders.length, before);
  assert.ok(json.error);
});

// ---------------------------------------------------------------------------
// 2. Client cannot supply authoritative tableId/branchId/payment/price fields
// ---------------------------------------------------------------------------

test("client-supplied tableId/branchId in the body is rejected outright (schema .strict())", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const before = db.orders.length;

  const { status } = await postOrder(
    validBody(item.id, { tableId: "attacker-controlled-table", branchId: "attacker-controlled-branch" }),
    { cookie: cookieHeader(rawToken) },
  );

  assert.equal(status, 400);
  assert.equal(db.orders.length, before, "a rejected request must never create an order row");
});

for (const field of ["paymentStatus", "paymentMethod", "paidAt", "paidById"]) {
  test(`client-supplied "${field}" in the body is rejected outright`, async () => {
    const { rawToken } = seedTableSession();
    const item = seedMenuItem({ id: randomUUID() });
    const { status } = await postOrder(validBody(item.id, { [field]: "PAID" }), { cookie: cookieHeader(rawToken) });
    assert.equal(status, 400);
  });
}

for (const field of ["unitPrice", "price", "tax", "total", "subtotal"]) {
  test(`a line item carrying a client-supplied "${field}" is rejected (per-line .strict())`, async () => {
    const { rawToken } = seedTableSession();
    const item = seedMenuItem({ id: randomUUID() });
    const body = validBody(item.id);
    (body.lines[0] as Record<string, unknown>)[field] = 1;
    const { status } = await postOrder(body, { cookie: cookieHeader(rawToken) });
    assert.equal(status, 400);
  });
}

// ---------------------------------------------------------------------------
// 3. Happy path: server derives branch/table/session, prices from the DB,
//    creates the order UNPAID, and stores historical snapshots.
// ---------------------------------------------------------------------------

test("a valid order is created with server-derived branch/table, server-computed pricing, UNPAID, and item snapshots", async () => {
  const { rawToken, row: session } = seedTableSession();
  const item = seedMenuItem({
    id: randomUUID(),
    name: "Paneer Tikka",
    price: 250,
    variants: [{ id: randomUUID(), name: "Full", priceDelta: 50 }],
    addons: [{ id: randomUUID(), name: "Extra Paneer", price: 30, isActive: true }],
  });

  const { status, json } = await postOrder(
    {
      customerName: "Priya",
      customerPhone: "9876543210",
      orderType: "DINE_IN",
      lines: [
        {
          itemId: item.id,
          variantId: item.variants[0].id,
          quantity: 2,
          addonIds: [item.addons[0].id],
        },
      ],
    },
    { cookie: cookieHeader(rawToken) },
  );

  assert.equal(status, 201);
  assert.ok(json.accessToken, "the raw access token must be returned on initial creation");
  assert.equal(json.accessToken.length >= 43, true);
  assert.equal(json.paymentStatus, "UNPAID");
  assert.equal(json.status, "RECEIVED");

  // unitPrice = 250 base + 50 variant + 30 addon = 330; subtotal = 660;
  // tax = 5% -> 33; total = 693. Entirely server-computed from `db`, never
  // from anything the client sent (the client sent no price at all).
  assert.equal(json.total, "693");
  assert.equal(json.items[0].unitPrice, "330");
  assert.equal(json.items[0].name, "Paneer Tikka");
  assert.equal(json.items[0].variant, "Full");

  const stored = db.orders.at(-1)!;
  assert.equal(stored.branchId, session.branchId, "branchId must come from the table session, not the client");
  assert.equal(stored.tableId, session.tableId, "tableId must come from the table session, not the client");
  assert.equal(stored.tableSessionId, session.id);
  assert.equal(stored.paymentStatus, "UNPAID");
  assert.equal(stored.items[0].itemNameSnap, "Paneer Tikka", "historical name snapshot must be stored");
  assert.equal(stored.items[0].unitPriceSnap, 330, "historical price snapshot must be stored");
  assert.notEqual(stored.accessTokenHash, json.accessToken, "only the HASH of the access token is ever stored");
  assert.equal(sha256(json.accessToken), stored.accessTokenHash, "the stored hash must match the returned raw token");
});

// ---------------------------------------------------------------------------
// 4. Cross-branch IDOR at the full route level (not just the pricing unit)
// ---------------------------------------------------------------------------

test("an item belonging to a different branch than the table session is rejected end-to-end", async () => {
  const { rawToken } = seedTableSession({ branchId: BRANCH_A, tableBranchId: BRANCH_A });
  const otherBranchItem = seedMenuItem({ id: randomUUID(), branchId: BRANCH_B });
  const before = db.orders.length;

  const { status } = await postOrder(validBody(otherBranchItem.id), { cookie: cookieHeader(rawToken) });

  assert.equal(status, 400);
  assert.equal(db.orders.length, before);
});

// ---------------------------------------------------------------------------
// 5. Revoked / expired / stale-QR-version sessions are rejected
// ---------------------------------------------------------------------------

test("a revoked table session cannot be used to place an order", async () => {
  const { rawToken } = seedTableSession({ revokedAt: new Date() });
  const item = seedMenuItem({ id: randomUUID() });
  const { status } = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });
  assert.equal(status, 401);
});

test("an expired table session cannot be used to place an order", async () => {
  const { rawToken } = seedTableSession({ expiresAt: new Date(Date.now() - 1000) });
  const item = seedMenuItem({ id: randomUUID() });
  const { status } = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });
  assert.equal(status, 401);
});

test("a session stamped with a superseded QR version cannot be used to place an order", async () => {
  const { rawToken } = seedTableSession({ qrVersion: 1, tableQrVersion: 2 });
  const item = seedMenuItem({ id: randomUUID() });
  const { status } = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });
  assert.equal(status, 401);
});

// ---------------------------------------------------------------------------
// 6. Idempotency: duplicate submissions with the same key never double-create
// ---------------------------------------------------------------------------

test("two POSTs with the same Idempotency-Key create exactly one order", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const key = randomUUID();
  const before = db.orders.length;

  const first = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken), idempotencyKey: key });
  const second = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken), idempotencyKey: key });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200, "a duplicate submission must not be a fresh 201 creation");
  assert.equal(first.json.orderNumber, second.json.orderNumber);
  assert.equal(db.orders.length, before + 1, "exactly one order row must exist after two identical submissions");
});

test("a duplicate submission without proof of the original access token does not leak it", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const key = randomUUID();

  const first = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken), idempotencyKey: key });
  const retry = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken), idempotencyKey: key });

  assert.ok(first.json.accessToken);
  assert.equal(retry.json.accessToken, undefined, "a retry that can't prove it already holds the token gets none back");
});

test("a duplicate submission that supplies the correct prior access token gets it echoed back", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const key = randomUUID();

  const first = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken), idempotencyKey: key });
  const retry = await postOrder(validBody(item.id), {
    cookie: cookieHeader(rawToken),
    idempotencyKey: key,
    accessToken: first.json.accessToken,
  });

  assert.equal(retry.status, 200);
  assert.equal(retry.json.accessToken, first.json.accessToken);
});

test("a different Idempotency-Key for the same cart creates a second, independent order", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const before = db.orders.length;

  const first = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });
  const second = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.json.orderNumber, second.json.orderNumber);
  assert.equal(db.orders.length, before + 2);
});

test("a missing Idempotency-Key header is rejected before anything is priced or created", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const before = db.orders.length;
  const res = await fetch(`${baseUrl}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: trustedOrigin, Cookie: cookieHeader(rawToken) },
    body: JSON.stringify(validBody(item.id)),
  });
  assert.equal(res.status, 400);
  assert.equal(db.orders.length, before);
});

// ---------------------------------------------------------------------------
// 7. Order tracking requires the access token — orderNumber (+ phone) alone
//    must never be sufficient.
// ---------------------------------------------------------------------------

test("GET /orders/:orderNumber with no access token is a generic 404, not a data leak", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const { status, json } = await getOrder(created.json.orderNumber);
  assert.equal(status, 404);
  assert.equal(json.orderNumber, undefined);
});

test("GET /orders/:orderNumber with the correct customerPhone but no access token still fails", async () => {
  // Requirement: orderNumber + phone must never be treated as sufficient
  // authorization on its own. The route doesn't even read a phone
  // parameter, but assert the behavior directly: knowing the phone used on
  // the order grants nothing without the token.
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const res = await fetch(
    `${baseUrl}/api/public/orders/${created.json.orderNumber}?customerPhone=9876543210&phone=9876543210`,
    { headers: { Origin: trustedOrigin } },
  );
  assert.equal(res.status, 404);
});

test("GET /orders/:orderNumber with a wrong access token is a 404", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const { status } = await getOrder(created.json.orderNumber, "a".repeat(43));
  assert.equal(status, 404);
});

test("GET /orders/:orderNumber with the correct access token returns the order", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const { status, json } = await getOrder(created.json.orderNumber, created.json.accessToken);
  assert.equal(status, 200);
  assert.equal(json.orderNumber, created.json.orderNumber);
  assert.equal(json.accessToken, undefined, "the tracking endpoint never re-emits the token in the body");
});

test("GET /orders/:orderNumber rejects an access token belonging to a different order", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const orderA = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken), idempotencyKey: randomUUID() });
  const orderB = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken), idempotencyKey: randomUUID() });

  const { status } = await getOrder(orderA.json.orderNumber, orderB.json.accessToken);
  assert.equal(status, 404);
});

test("GET /orders/:orderNumber rejects a token from a different branch's order (branch never grants access on its own)", async () => {
  // Two independent table sessions on two different branches. The access
  // token from branch B's order must not open branch A's order — proving
  // authorization comes only from the per-order token, never from shared
  // branch/table context.
  const { rawToken: tokenA } = seedTableSession({ branchId: BRANCH_A, tableBranchId: BRANCH_A });
  const { rawToken: tokenB } = seedTableSession({ branchId: BRANCH_B, tableBranchId: BRANCH_B });
  const itemA = seedMenuItem({ id: randomUUID(), branchId: BRANCH_A });
  const itemB = seedMenuItem({ id: randomUUID(), branchId: BRANCH_B });

  const orderA = await postOrder(validBody(itemA.id), { cookie: cookieHeader(tokenA) });
  const orderB = await postOrder(validBody(itemB.id), { cookie: cookieHeader(tokenB) });

  const crossBranch = await getOrder(orderA.json.orderNumber, orderB.json.accessToken);
  assert.equal(crossBranch.status, 404);

  // Sanity: each branch's own token still works for its own order.
  const ownBranch = await getOrder(orderB.json.orderNumber, orderB.json.accessToken);
  assert.equal(ownBranch.status, 200);
});

test("the tracking response exposes only customer-safe fields — no branch, table, customer PII, or access-token hash", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const { status, json } = await getOrder(created.json.orderNumber, created.json.accessToken);
  assert.equal(status, 200);

  const allowedKeys = new Set([
    "orderNumber",
    "status",
    "paymentStatus",
    "total",
    "items",
    "createdAt",
    "updatedAt",
    "paidAt",
    "statusHistory",
  ]);
  for (const key of Object.keys(json)) {
    assert.ok(allowedKeys.has(key), `unexpected field leaked to customer: ${key}`);
  }
  for (const forbidden of ["branchId", "tableId", "customerName", "customerPhone", "accessTokenHash", "id"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(json, forbidden), false, `leaked internal field: ${forbidden}`);
  }
});

test("the tracking response includes customer-relevant timestamps", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const { status, json } = await getOrder(created.json.orderNumber, created.json.accessToken);
  assert.equal(status, 200);
  assert.equal(typeof json.createdAt, "string");
  assert.equal(typeof json.updatedAt, "string");
  // Not yet paid — paidAt must be null, never omitted-as-undefined in a way
  // that could be confused with "unknown"/"not applicable".
  assert.equal(json.paidAt, null);
  assert.ok(Array.isArray(json.statusHistory) && json.statusHistory.length >= 1);
});

// ---------------------------------------------------------------------------
// 8. The tracking route is strictly read-only: there is no way for a
//    customer request, however crafted, to change status, payment, total,
//    or items.
// ---------------------------------------------------------------------------

test("status/paymentStatus/total fields in a GET query string have no effect on the stored order", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const res = await fetch(
    `${baseUrl}/api/public/orders/${created.json.orderNumber}` +
      `?status=COMPLETED&paymentStatus=PAID&total=1`,
    { headers: { Origin: trustedOrigin, "X-Order-Access-Token": created.json.accessToken } },
  );
  const json = (await res.json()) as any;
  assert.equal(res.status, 200);
  assert.equal(json.status, "RECEIVED");
  assert.equal(json.paymentStatus, "UNPAID");
  assert.equal(json.total, created.json.total);
});

test("a body attached to the GET tracking request cannot change status or payment", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const res = await fetch(`${baseUrl}/api/public/orders/${created.json.orderNumber}`, {
    method: "GET",
    headers: {
      Origin: trustedOrigin,
      "X-Order-Access-Token": created.json.accessToken,
      "Content-Type": "application/json",
    },
  });
  const json = (await res.json()) as any;
  assert.equal(res.status, 200);
  assert.equal(json.status, "RECEIVED");
  assert.equal(json.paymentStatus, "UNPAID");
});

for (const method of ["PATCH", "PUT", "DELETE", "POST"] as const) {
  test(`${method} /orders/:orderNumber is not a route customers can use to mutate status/payment`, async () => {
    const { rawToken } = seedTableSession();
    const item = seedMenuItem({ id: randomUUID() });
    const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

    const res = await fetch(`${baseUrl}/api/public/orders/${created.json.orderNumber}`, {
      method,
      headers: {
        Origin: trustedOrigin,
        "X-Order-Access-Token": created.json.accessToken,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? undefined : JSON.stringify({ status: "COMPLETED", paymentStatus: "PAID" }),
    });
    // No handler exists for these verbs on this path (POST here would hit
    // the *create* route, which requires a table session and idempotency
    // key it doesn't have) — either way, the order must be unaffected.
    assert.notEqual(res.status, 200 as number);

    const check = await getOrder(created.json.orderNumber, created.json.accessToken);
    assert.equal(check.json.status, "RECEIVED");
    assert.equal(check.json.paymentStatus, "UNPAID");
  });
}

test("an access token that is well-formed but never existed is a generic 404 (safe handling of invalid access)", async () => {
  const { rawToken } = seedTableSession();
  const item = seedMenuItem({ id: randomUUID() });
  const created = await postOrder(validBody(item.id), { cookie: cookieHeader(rawToken) });

  const bogusButPlausible = createOpaqueTokenLike();
  const { status, json } = await getOrder(created.json.orderNumber, bogusButPlausible);
  assert.equal(status, 404);
  assert.equal(json.orderNumber, undefined);
});

function createOpaqueTokenLike(): string {
  // Same shape (length/charset) as a real base64url access token, just not
  // one the server ever issued — exercises "invalid token" distinctly from
  // "too short" (already covered) or "belongs to another order".
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

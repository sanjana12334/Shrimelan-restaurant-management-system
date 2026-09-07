import assert from "node:assert/strict";
import test from "node:test";
import {
  TableSessionError,
  createTableSession,
  resolveActiveTableSession,
  resolveTableFromQrCredential,
} from "./table-session.service";
import { createOpaqueToken, hashToken } from "../security/tokens";

/**
 * Security-focused tests for the customer QR-entry / table-session flow:
 * valid QR, invalid QR, old (regenerated) QR, inactive table, expired
 * session, revoked session, and confirmation that tableId/branchId can
 * never be influenced by client input.
 *
 * Uses a minimal fake Prisma client (same pattern as the other
 * *.branch-security.test.ts files) — enough of restaurantTable.findUnique /
 * tableSession.create / tableSession.findFirst / tableSession.update to
 * exercise the real logic without a live database.
 */

interface FakeTable {
  id: string;
  branchId: string;
  label: string;
  qrTokenHash: string;
  qrVersion: number;
  active: boolean;
}

interface FakeSession {
  id: string;
  tableId: string;
  branchId: string;
  sessionTokenHash: string;
  qrVersion: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

function makeFakeTable(overrides: Partial<FakeTable> = {}): FakeTable {
  return {
    id: "table-1",
    branchId: "branch-1",
    label: "Table 7",
    qrTokenHash: hashToken("initial-qr-token-for-table-1-xxxxxxxxxxxxxxxxxxxx"),
    qrVersion: 1,
    active: true,
    ...overrides,
  };
}

function makeFakePrisma(tables: FakeTable[], sessions: FakeSession[] = []) {
  let sessionCounter = 0;
  return {
    restaurantTable: {
      findUnique: async ({ where }: any) => {
        const table = tables.find((t) => t.qrTokenHash === where.qrTokenHash);
        return table ? { ...table } : null;
      },
    },
    tableSession: {
      create: async ({ data }: any) => {
        sessionCounter += 1;
        const id = `session-${sessionCounter}`;
        sessions.push({
          id,
          tableId: data.tableId,
          branchId: data.branchId,
          sessionTokenHash: data.sessionTokenHash,
          qrVersion: data.qrVersion,
          expiresAt: data.expiresAt,
          revokedAt: null,
        });
        return { id };
      },
      findFirst: async ({ where }: any) => {
        const now = new Date();
        const session = sessions.find(
          (s) =>
            s.sessionTokenHash === where.sessionTokenHash &&
            s.revokedAt === null &&
            s.expiresAt.getTime() > now.getTime(),
        );
        if (!session) return null;
        const table = tables.find((t) => t.id === session.tableId);
        if (!table || !table.active) return null;
        return {
          id: session.id,
          tableId: session.tableId,
          branchId: session.branchId,
          qrVersion: session.qrVersion,
          expiresAt: session.expiresAt,
          table: { qrVersion: table.qrVersion, branchId: table.branchId },
        };
      },
      update: async ({ where, data }: any) => {
        const session = sessions.find((s) => s.id === where.id);
        if (session) Object.assign(session, data);
        return session;
      },
    },
  } as any;
}

// ---------------------------------------------------------------------------
// resolveTableFromQrCredential — QR validation
// ---------------------------------------------------------------------------

test("valid QR: resolves the correct table from its credential", async () => {
  const rawToken = createOpaqueToken(32);
  const table = makeFakeTable({ qrTokenHash: hashToken(rawToken) });
  const prisma = makeFakePrisma([table]);

  const resolved = await resolveTableFromQrCredential(prisma, rawToken);
  assert.equal(resolved.id, "table-1");
  assert.equal(resolved.branchId, "branch-1");
  assert.equal(resolved.qrVersion, 1);
});

test("invalid QR: an unknown/garbage token is rejected with a generic 404", async () => {
  const table = makeFakeTable();
  const prisma = makeFakePrisma([table]);

  await assert.rejects(
    () => resolveTableFromQrCredential(prisma, createOpaqueToken(32)),
    (err: unknown) => {
      assert.ok(err instanceof TableSessionError);
      assert.equal(err.status, 404);
      assert.equal(err.message, "Invalid table QR");
      return true;
    },
  );
});

test("inactive table: a structurally valid QR for a deactivated table is rejected with the SAME message as an unknown token — no existence leak", async () => {
  const rawToken = createOpaqueToken(32);
  const table = makeFakeTable({ qrTokenHash: hashToken(rawToken), active: false });
  const prisma = makeFakePrisma([table]);

  await assert.rejects(
    () => resolveTableFromQrCredential(prisma, rawToken),
    (err: unknown) => {
      assert.ok(err instanceof TableSessionError);
      assert.equal(err.status, 404);
      assert.equal(err.message, "Invalid table QR");
      return true;
    },
  );
});

test("resolved table never carries the qrTokenHash field", async () => {
  const rawToken = createOpaqueToken(32);
  const table = makeFakeTable({ qrTokenHash: hashToken(rawToken) });
  const prisma = makeFakePrisma([table]);

  const resolved = await resolveTableFromQrCredential(prisma, rawToken);
  assert.equal(Object.prototype.hasOwnProperty.call(resolved, "qrTokenHash"), false);
});

// ---------------------------------------------------------------------------
// createTableSession
// ---------------------------------------------------------------------------

test("createTableSession stores only a hash of the session token, never the raw value", async () => {
  const table = makeFakeTable();
  const sessions: FakeSession[] = [];
  const prisma = makeFakePrisma([table], sessions);

  const result = await createTableSession(prisma, { id: table.id, branchId: table.branchId, label: table.label, qrVersion: table.qrVersion }, 60_000);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionTokenHash, hashToken(result.rawSessionToken));
  assert.notEqual(sessions[0].sessionTokenHash, result.rawSessionToken);
});

test("createTableSession's raw token has at least 256 bits of entropy", async () => {
  const table = makeFakeTable();
  const prisma = makeFakePrisma([table]);
  const result = await createTableSession(prisma, table, 60_000);
  // base64url-encoded 32 random bytes is at least 43 characters.
  assert.ok(result.rawSessionToken.length >= 43);
});

test("createTableSession ties the session to table, branch, qrVersion, and an expiration", async () => {
  const table = makeFakeTable({ qrVersion: 3 });
  const sessions: FakeSession[] = [];
  const prisma = makeFakePrisma([table], sessions);

  await createTableSession(prisma, table, 60_000);

  assert.equal(sessions[0].tableId, table.id);
  assert.equal(sessions[0].branchId, table.branchId);
  assert.equal(sessions[0].qrVersion, 3);
  assert.ok(sessions[0].expiresAt instanceof Date);
  assert.ok(sessions[0].expiresAt.getTime() > Date.now());
});

// ---------------------------------------------------------------------------
// resolveActiveTableSession
// ---------------------------------------------------------------------------

test("valid session: a fresh, unexpired, unrevoked session for an active table resolves", async () => {
  const table = makeFakeTable();
  const rawToken = createOpaqueToken(32);
  const sessions: FakeSession[] = [
    {
      id: "session-1",
      tableId: table.id,
      branchId: table.branchId,
      sessionTokenHash: hashToken(rawToken),
      qrVersion: table.qrVersion,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    },
  ];
  const prisma = makeFakePrisma([table], sessions);

  const resolved = await resolveActiveTableSession(prisma, rawToken);
  assert.ok(resolved);
  assert.equal(resolved!.tableId, table.id);
  assert.equal(resolved!.branchId, table.branchId);
});

test("expired session: rejected even though the row is otherwise unrevoked", async () => {
  const table = makeFakeTable();
  const rawToken = createOpaqueToken(32);
  const sessions: FakeSession[] = [
    {
      id: "session-1",
      tableId: table.id,
      branchId: table.branchId,
      sessionTokenHash: hashToken(rawToken),
      qrVersion: table.qrVersion,
      expiresAt: new Date(Date.now() - 1_000), // already expired
      revokedAt: null,
    },
  ];
  const prisma = makeFakePrisma([table], sessions);

  const resolved = await resolveActiveTableSession(prisma, rawToken);
  assert.equal(resolved, null);
});

test("revoked session: rejected even though it hasn't expired yet", async () => {
  const table = makeFakeTable();
  const rawToken = createOpaqueToken(32);
  const sessions: FakeSession[] = [
    {
      id: "session-1",
      tableId: table.id,
      branchId: table.branchId,
      sessionTokenHash: hashToken(rawToken),
      qrVersion: table.qrVersion,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(), // explicitly revoked (e.g. QR regenerated)
    },
  ];
  const prisma = makeFakePrisma([table], sessions);

  const resolved = await resolveActiveTableSession(prisma, rawToken);
  assert.equal(resolved, null);
});

test("old QR: a session minted under a previous qrVersion is rejected once the table's QR has been regenerated", async () => {
  // Session was created when the table's QR was at version 1.
  const table = makeFakeTable({ qrVersion: 2 }); // table has since been regenerated to version 2
  const rawToken = createOpaqueToken(32);
  const sessions: FakeSession[] = [
    {
      id: "session-1",
      tableId: table.id,
      branchId: table.branchId,
      sessionTokenHash: hashToken(rawToken),
      qrVersion: 1, // stale — stamped against the old QR
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    },
  ];
  const prisma = makeFakePrisma([table], sessions);

  const resolved = await resolveActiveTableSession(prisma, rawToken);
  assert.equal(resolved, null);
});

test("inactive table: a session for a table that has since been deactivated is rejected", async () => {
  const table = makeFakeTable({ active: false });
  const rawToken = createOpaqueToken(32);
  const sessions: FakeSession[] = [
    {
      id: "session-1",
      tableId: table.id,
      branchId: table.branchId,
      sessionTokenHash: hashToken(rawToken),
      qrVersion: table.qrVersion,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    },
  ];
  const prisma = makeFakePrisma([table], sessions);

  const resolved = await resolveActiveTableSession(prisma, rawToken);
  assert.equal(resolved, null);
});

test("missing/undefined token resolves to null without querying anything unsafe", async () => {
  const prisma = makeFakePrisma([]);
  assert.equal(await resolveActiveTableSession(prisma, undefined), null);
  assert.equal(await resolveActiveTableSession(prisma, null), null);
  assert.equal(await resolveActiveTableSession(prisma, ""), null);
});

test("branchId manipulation: resolveActiveTableSession has no parameter through which a caller can supply tableId/branchId — resolution is driven only by the opaque token", async () => {
  // Structural guarantee: the function signature only accepts the raw
  // session token. There is no code path (route or service) where a
  // customer's request body/query/params can influence which table or
  // branch a session resolves to.
  assert.equal(resolveActiveTableSession.length, 2); // (prisma, rawSessionToken)
});

test("tableId manipulation: a session created for table-1/branch-1 can never resolve to a different table/branch, regardless of which table row also matches the query", async () => {
  const tableA = makeFakeTable({ id: "table-a", branchId: "branch-a" });
  const tableB = makeFakeTable({ id: "table-b", branchId: "branch-b", qrTokenHash: hashToken("other-qr-token-entirely-unrelated-xxxxxxxxxxxxxx") });
  const rawToken = createOpaqueToken(32);
  const sessions: FakeSession[] = [
    {
      id: "session-1",
      tableId: tableA.id,
      branchId: tableA.branchId,
      sessionTokenHash: hashToken(rawToken),
      qrVersion: tableA.qrVersion,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    },
  ];
  const prisma = makeFakePrisma([tableA, tableB], sessions);

  const resolved = await resolveActiveTableSession(prisma, rawToken);
  assert.ok(resolved);
  assert.equal(resolved!.tableId, "table-a");
  assert.equal(resolved!.branchId, "branch-a");
});

test("resolved active session never carries a sessionTokenHash field", async () => {
  const table = makeFakeTable();
  const rawToken = createOpaqueToken(32);
  const sessions: FakeSession[] = [
    {
      id: "session-1",
      tableId: table.id,
      branchId: table.branchId,
      sessionTokenHash: hashToken(rawToken),
      qrVersion: table.qrVersion,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    },
  ];
  const prisma = makeFakePrisma([table], sessions);

  const resolved = await resolveActiveTableSession(prisma, rawToken);
  assert.ok(resolved);
  assert.equal(Object.prototype.hasOwnProperty.call(resolved, "sessionTokenHash"), false);
});

import assert from "node:assert/strict";
import test, { mock } from "node:test";
import http from "node:http";
import express from "express";

const queries: unknown[] = [];
const rows = [
  {
    id: "audit-a",
    action: "ORDER_STATUS_CHANGED",
    targetType: "Order",
    targetId: "order-a",
    metadata: { next: "READY", authorization: "Bearer must-not-leak" },
    createdAt: new Date("2026-09-07T12:00:00.000Z"),
    staff: { id: "staff-a", name: "Admin A" },
  },
  {
    id: "audit-b",
    action: "PAYMENT_MARKED_PAID",
    targetType: "Order",
    targetId: "order-b",
    metadata: { paymentMethod: "CASH" },
    createdAt: new Date("2026-09-07T11:00:00.000Z"),
    staff: { id: "staff-a", name: "Admin A" },
  },
];

mock.module("../lib/prisma", {
  namedExports: {
    prisma: {
      auditLog: {
        async findMany(query: unknown) {
          queries.push(query);
          return rows;
        },
      },
    },
  },
});

// Load after the mock registration above; the route imports the shared Prisma
// singleton and must receive this test double rather than a real database.
const { auditLogRouter } = require("./audit-log.routes") as typeof import("./audit-log.routes");

function request(app: express.Express, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not start test server"));
      http.get({ hostname: "127.0.0.1", port: address.port, path }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) });
        });
      }).on("error", (error) => {
        server.close();
        reject(error);
      });
    });
  });
}

test("GET /api/admin/audit-logs rejects an unauthenticated request", async () => {
  const app = express();
  app.use("/api/admin", auditLogRouter);

  const response = await request(app, "/api/admin/audit-logs");
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: "Not authenticated" });
});

test("GET /api/admin/audit-logs derives branch scope from the verified session and returns a safe page", async () => {
  queries.length = 0;
  const app = express();
  app.use((req, _res, next) => {
    // Represents attachStaff's already DB-verified identity. No request
    // input is used to set branchId in the production route.
    req.staff = { staffId: "staff-a", branchId: "branch-a", sessionId: "session-a" };
    next();
  });
  app.use("/api/admin", auditLogRouter);

  const response = await request(app, "/api/admin/audit-logs?branchId=branch-b&limit=1");
  assert.equal(response.status, 200);
  assert.equal(queries.length, 1);
  assert.deepEqual((queries[0] as { where: unknown }).where, { branchId: "branch-a" });
  assert.deepEqual((queries[0] as { orderBy: unknown }).orderBy, [{ createdAt: "desc" }, { id: "desc" }]);

  const body = response.body as { logs: Array<Record<string, unknown>>; nextCursor: string | null };
  assert.equal(body.logs.length, 1);
  assert.equal(body.logs[0].staff, undefined, "internal relation name must not be returned");
  assert.deepEqual(body.logs[0].actor, { id: "staff-a", name: "Admin A" });
  assert.deepEqual(body.logs[0].metadata, { next: "READY", authorization: "[REDACTED]" });
  assert.ok(body.nextCursor, "a full page must include a cursor for the next page");
});

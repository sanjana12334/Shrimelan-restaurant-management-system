import assert from "node:assert/strict";
import test from "node:test";
import { OrderTransitionError, transitionOrderStatus } from "./order-state.service";

/**
 * Branch-authorization ("IDOR") coverage for transitionOrderStatus.
 *
 * order-state.service.test.ts already exercises the pure state-machine
 * table (canTransitionOrderStatus / assertOrderStatusTransition), but never
 * calls transitionOrderStatus itself, so the branch-scoped DB lookup this
 * function performs had no dedicated test. This file closes that gap using
 * the same minimal-fake-Prisma pattern as payment.service.test.ts: enough
 * of $transaction / order.findFirst / order.updateMany / orderStatusHistory
 * .create / auditLog.create to exercise the real branch-isolation logic
 * without a live database.
 */

function makeFakeOrder(overrides: Partial<{
  id: string;
  branchId: string;
  status: string;
}> = {}) {
  return {
    id: "order-1",
    branchId: "branch-1",
    status: "RECEIVED",
    ...overrides,
  };
}

function makeFakePrisma(store: ReturnType<typeof makeFakeOrder> | null) {
  const auditLogs: Array<Record<string, unknown>> = [];
  const statusHistory: Array<Record<string, unknown>> = [];

  const tx = {
    order: {
      findFirst: async ({ where }: any) => {
        if (!store) return null;
        if (where.id !== store.id || where.branchId !== store.branchId) return null;
        return { ...store };
      },
      updateMany: async ({ where, data }: any) => {
        if (!store || store.id !== where.id || store.status !== where.status) {
          return { count: 0 };
        }
        Object.assign(store, data);
        return { count: 1 };
      },
    },
    orderStatusHistory: {
      create: async ({ data }: any) => {
        statusHistory.push(data);
        return data;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      },
    },
  };

  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    auditLogs,
    statusHistory,
  } as any;
}

test("transitions an order that belongs to the actor's own branch", async () => {
  const store = makeFakeOrder();
  const prisma = makeFakePrisma(store);

  const result = await transitionOrderStatus(
    prisma,
    { staffId: "staff-1", branchId: "branch-1" },
    "order-1",
    "CONFIRMED",
  );

  assert.equal(result.status, "CONFIRMED");
  assert.equal(store.status, "CONFIRMED");
  assert.equal(prisma.statusHistory.length, 1);
  assert.equal(prisma.auditLogs.length, 1);
});

test("an order belonging to another branch resolves to the same generic 404 as nonexistent — branch isolation (IDOR)", async () => {
  const store = makeFakeOrder({ branchId: "branch-2" });
  const prisma = makeFakePrisma(store);

  await assert.rejects(
    () => transitionOrderStatus(prisma, { staffId: "staff-1", branchId: "branch-1" }, "order-1", "CONFIRMED"),
    (err: unknown) => {
      assert.ok(err instanceof OrderTransitionError);
      assert.equal(err.status, 404);
      assert.equal(err.message, "Order not found");
      return true;
    },
  );

  // No mutation, no status-history row, and no audit entry leaked across
  // the branch boundary — a malicious ADMIN guessing another branch's
  // orderId gets zero side effects and zero information disclosure.
  assert.equal(store.status, "RECEIVED");
  assert.equal(prisma.statusHistory.length, 0);
  assert.equal(prisma.auditLogs.length, 0);
});

test("a nonexistent order id is rejected with the identical 404 shape as a cross-branch id", async () => {
  const prisma = makeFakePrisma(null);

  await assert.rejects(
    () => transitionOrderStatus(prisma, { staffId: "staff-1", branchId: "branch-1" }, "does-not-exist", "CONFIRMED"),
    (err: unknown) => {
      assert.ok(err instanceof OrderTransitionError);
      assert.equal(err.status, 404);
      assert.equal(err.message, "Order not found");
      return true;
    },
  );
});

test("cross-branch attempts cannot be used to probe order status via the transition error message", async () => {
  // If a cross-branch order somehow reached the transition-validation step
  // (it must not), the resulting 409 message embeds the real current
  // status, which would leak information about another branch's order.
  // This asserts the branch check happens first, before that code path is
  // reachable at all.
  const store = makeFakeOrder({ branchId: "branch-2", status: "COMPLETED" });
  const prisma = makeFakePrisma(store);

  await assert.rejects(
    () => transitionOrderStatus(prisma, { staffId: "staff-1", branchId: "branch-1" }, "order-1", "CONFIRMED"),
    (err: unknown) => {
      assert.ok(err instanceof OrderTransitionError);
      assert.equal(err.status, 404);
      // Must be the generic not-found message, never one mentioning COMPLETED.
      assert.equal(err.message, "Order not found");
      return true;
    },
  );
});

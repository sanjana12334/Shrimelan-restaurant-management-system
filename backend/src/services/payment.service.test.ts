import assert from "node:assert/strict";
import test from "node:test";
import { markOrderPaid, PaymentTransitionError } from "./payment.service";

/**
 * A minimal fake Prisma client covering only what markOrderPaid touches:
 * $transaction, order.findFirst, order.updateMany, and auditLog.create.
 * Good enough to exercise the real transition logic (branch scoping,
 * eligibility checks, the conditional updateMany, and the audit write)
 * without a live database.
 */
function makeFakeOrder(overrides: Partial<{
  id: string;
  branchId: string;
  paymentStatus: string;
  status: string;
}> = {}) {
  return {
    id: "order-1",
    branchId: "branch-1",
    paymentStatus: "UNPAID",
    status: "RECEIVED",
    ...overrides,
  };
}

function makeFakePrisma(store: ReturnType<typeof makeFakeOrder> | null, opts: { raceOnRead?: boolean } = {}) {
  const auditLogs: Array<Record<string, unknown>> = [];

  const tx = {
    order: {
      findFirst: async ({ where }: any) => {
        if (!store) return null;
        if (where.id !== store.id || where.branchId !== store.branchId) return null;
        const snapshot = { ...store };
        if (opts.raceOnRead) {
          // Simulate a concurrent writer flipping paymentStatus to PAID in
          // the window between our read and our conditional update.
          store.paymentStatus = "PAID";
        }
        return snapshot;
      },
      updateMany: async ({ where, data }: any) => {
        if (!store || store.id !== where.id || store.paymentStatus !== where.paymentStatus) {
          return { count: 0 };
        }
        Object.assign(store, data);
        return { count: 1 };
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
  } as any;
}

test("marks an eligible UNPAID order as PAID and records payer/time/method", async () => {
  const store = makeFakeOrder();
  const prisma = makeFakePrisma(store);

  const result = await markOrderPaid(prisma, { staffId: "staff-1", branchId: "branch-1" }, "order-1", "CASH", "1.2.3.4");

  assert.equal(result.id, "order-1");
  assert.equal(result.paymentStatus, "PAID");
  assert.equal(result.paymentMethod, "CASH");
  assert.ok(result.paidAt instanceof Date);

  assert.equal(store.paymentStatus, "PAID");
  assert.equal((store as any).paymentMethod, "CASH");
  assert.equal((store as any).paidById, "staff-1");
  assert.ok((store as any).paidAt instanceof Date);
});

test("records exactly one audit log entry with the payment method, no secrets", async () => {
  const store = makeFakeOrder();
  const prisma = makeFakePrisma(store);

  await markOrderPaid(prisma, { staffId: "staff-1", branchId: "branch-1" }, "order-1", "UPI");

  assert.equal(prisma.auditLogs.length, 1);
  assert.equal(prisma.auditLogs[0].action, "PAYMENT_MARKED_PAID");
  assert.equal(prisma.auditLogs[0].staffId, "staff-1");
  assert.equal(prisma.auditLogs[0].targetId, "order-1");
  assert.equal(prisma.auditLogs[0].branchId, "branch-1");
  assert.deepEqual(prisma.auditLogs[0].metadata, { paymentMethod: "UPI" });
});

test("a nonexistent order id is rejected with a safe 404", async () => {
  const prisma = makeFakePrisma(null);
  await assert.rejects(
    () => markOrderPaid(prisma, { staffId: "staff-1", branchId: "branch-1" }, "missing", "CASH"),
    (err: unknown) => {
      assert.ok(err instanceof PaymentTransitionError);
      assert.equal(err.status, 404);
      assert.equal(err.message, "Order not found");
      return true;
    },
  );
});

test("an order belonging to another branch is rejected with the same 404 as nonexistent — branch isolation", async () => {
  const store = makeFakeOrder({ branchId: "branch-2" });
  const prisma = makeFakePrisma(store);

  await assert.rejects(
    () => markOrderPaid(prisma, { staffId: "staff-1", branchId: "branch-1" }, "order-1", "CASH"),
    (err: unknown) => {
      assert.ok(err instanceof PaymentTransitionError);
      assert.equal(err.status, 404);
      return true;
    },
  );
  // No mutation and no audit entry leaked across the branch boundary.
  assert.equal(store.paymentStatus, "UNPAID");
  assert.equal(prisma.auditLogs.length, 0);
});

test("a cancelled order can never be marked paid", async () => {
  const store = makeFakeOrder({ status: "CANCELLED" });
  const prisma = makeFakePrisma(store);

  await assert.rejects(
    () => markOrderPaid(prisma, { staffId: "staff-1", branchId: "branch-1" }, "order-1", "CASH"),
    (err: unknown) => {
      assert.ok(err instanceof PaymentTransitionError);
      assert.equal(err.status, 409);
      assert.match(err.message, /cancelled/i);
      return true;
    },
  );
  assert.equal(store.paymentStatus, "UNPAID");
  assert.equal(prisma.auditLogs.length, 0);
});

test("an already-PAID order cannot be marked paid again (duplicate transition rejected)", async () => {
  const store = makeFakeOrder({ paymentStatus: "PAID" });
  const prisma = makeFakePrisma(store);

  await assert.rejects(
    () => markOrderPaid(prisma, { staffId: "staff-1", branchId: "branch-1" }, "order-1", "CARD"),
    (err: unknown) => {
      assert.ok(err instanceof PaymentTransitionError);
      assert.equal(err.status, 409);
      assert.match(err.message, /unpaid orders/i);
      return true;
    },
  );
  assert.equal(prisma.auditLogs.length, 0);
});

test("a concurrent payment attempt racing the same order fails safely instead of double-recording", async () => {
  const store = makeFakeOrder();
  const prisma = makeFakePrisma(store, { raceOnRead: true });

  await assert.rejects(
    () => markOrderPaid(prisma, { staffId: "staff-1", branchId: "branch-1" }, "order-1", "CASH"),
    (err: unknown) => {
      assert.ok(err instanceof PaymentTransitionError);
      assert.equal(err.status, 409);
      assert.match(err.message, /concurrently/i);
      return true;
    },
  );
  // The racing writer's PAID state is preserved, not overwritten.
  assert.equal(store.paymentStatus, "PAID");
  assert.equal(prisma.auditLogs.length, 0);
});

test("payment is independent of order status for any non-cancelled state", async () => {
  for (const status of ["RECEIVED", "CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
    const store = makeFakeOrder({ status, id: `order-${status}` });
    const prisma = makeFakePrisma(store);
    const result = await markOrderPaid(prisma, { staffId: "staff-1", branchId: "branch-1" }, `order-${status}`, "CASH");
    assert.equal(result.paymentStatus, "PAID", `expected payment to succeed while order is ${status}`);
  }
});

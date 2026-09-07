import assert from "node:assert/strict";
import test from "node:test";
import { OrderStatus } from "@prisma/client";
import {
  ORDER_STATUS_TRANSITIONS,
  OrderTransitionError,
  assertOrderStatusTransition,
  canTransitionOrderStatus,
} from "./order-state.service";

const ALL_STATUSES: OrderStatus[] = ["RECEIVED", "CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];

test("normal flow transitions are all legal in order", () => {
  assert.equal(canTransitionOrderStatus("RECEIVED", "CONFIRMED"), true);
  assert.equal(canTransitionOrderStatus("CONFIRMED", "PREPARING"), true);
  assert.equal(canTransitionOrderStatus("PREPARING", "READY"), true);
  assert.equal(canTransitionOrderStatus("READY", "COMPLETED"), true);
});

test("cancellation is only reachable from RECEIVED and CONFIRMED", () => {
  assert.equal(canTransitionOrderStatus("RECEIVED", "CANCELLED"), true);
  assert.equal(canTransitionOrderStatus("CONFIRMED", "CANCELLED"), true);
  assert.equal(canTransitionOrderStatus("PREPARING", "CANCELLED"), false);
  assert.equal(canTransitionOrderStatus("READY", "CANCELLED"), false);
});

test("COMPLETED and CANCELLED are terminal — no outgoing transitions at all", () => {
  assert.deepEqual(ORDER_STATUS_TRANSITIONS.COMPLETED, []);
  assert.deepEqual(ORDER_STATUS_TRANSITIONS.CANCELLED, []);
  for (const target of ALL_STATUSES) {
    assert.equal(canTransitionOrderStatus("COMPLETED", target), false);
    assert.equal(canTransitionOrderStatus("CANCELLED", target), false);
  }
});

test("no skipping steps in the normal flow", () => {
  assert.equal(canTransitionOrderStatus("RECEIVED", "PREPARING"), false);
  assert.equal(canTransitionOrderStatus("RECEIVED", "READY"), false);
  assert.equal(canTransitionOrderStatus("RECEIVED", "COMPLETED"), false);
  assert.equal(canTransitionOrderStatus("CONFIRMED", "READY"), false);
  assert.equal(canTransitionOrderStatus("CONFIRMED", "COMPLETED"), false);
  assert.equal(canTransitionOrderStatus("PREPARING", "COMPLETED"), false);
});

test("no backward transitions anywhere in the normal flow", () => {
  assert.equal(canTransitionOrderStatus("CONFIRMED", "RECEIVED"), false);
  assert.equal(canTransitionOrderStatus("PREPARING", "CONFIRMED"), false);
  assert.equal(canTransitionOrderStatus("PREPARING", "RECEIVED"), false);
  assert.equal(canTransitionOrderStatus("READY", "PREPARING"), false);
  assert.equal(canTransitionOrderStatus("READY", "CONFIRMED"), false);
  assert.equal(canTransitionOrderStatus("READY", "RECEIVED"), false);
});

test("a status can never transition to itself", () => {
  for (const status of ALL_STATUSES) {
    assert.equal(canTransitionOrderStatus(status, status), false);
  }
});

test("every status in the enum has an explicit (possibly empty) transition list", () => {
  for (const status of ALL_STATUSES) {
    assert.ok(Array.isArray(ORDER_STATUS_TRANSITIONS[status]), `missing transition list for ${status}`);
  }
});

test("assertOrderStatusTransition passes silently for legal transitions", () => {
  assert.doesNotThrow(() => assertOrderStatusTransition("RECEIVED", "CONFIRMED"));
});

test("assertOrderStatusTransition throws a safe OrderTransitionError (409) for illegal transitions", () => {
  assert.throws(
    () => assertOrderStatusTransition("PREPARING", "CANCELLED"),
    (err: unknown) => {
      assert.ok(err instanceof OrderTransitionError);
      assert.equal((err as OrderTransitionError).status, 409);
      assert.match((err as OrderTransitionError).message, /Invalid order status transition/);
      return true;
    },
  );
});

test("assertOrderStatusTransition throws for any attempt to move out of a terminal state", () => {
  for (const target of ALL_STATUSES) {
    assert.throws(() => assertOrderStatusTransition("COMPLETED", target));
    assert.throws(() => assertOrderStatusTransition("CANCELLED", target));
  }
});

test("ORDER_STATUS_TRANSITIONS is frozen and cannot be mutated at runtime", () => {
  assert.throws(() => {
    // @ts-expect-error — intentionally attempting a runtime mutation of a readonly table
    ORDER_STATUS_TRANSITIONS.RECEIVED = ["COMPLETED"];
  });
});

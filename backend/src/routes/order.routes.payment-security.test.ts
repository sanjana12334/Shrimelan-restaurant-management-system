import assert from "node:assert/strict";
import test from "node:test";
import { createOrderSchema } from "./order.schemas";

/**
 * Business rule: customers never pay online, and payment happens only at
 * the counter, recorded by an ADMIN. These tests assert that guarantee at
 * the schema layer that guards the one public route that creates orders:
 * even if a customer's client sent paymentStatus/paymentMethod/paidAt/
 * paidById, `.strict()` rejects the request outright rather than silently
 * dropping or trusting those fields.
 */

const validBody = {
  customerName: "Test Customer",
  customerPhone: "9876543210",
  orderType: "DINE_IN" as const,
  lines: [
    {
      itemId: "11111111-1111-1111-1111-111111111111",
      quantity: 1,
      addonIds: [],
    },
  ],
};

test("a well-formed order body with no payment fields parses successfully", () => {
  const result = createOrderSchema.safeParse(validBody);
  assert.equal(result.success, true);
});

for (const field of ["paymentStatus", "paymentMethod", "paidAt", "paidById"] as const) {
  test(`createOrderSchema rejects a request body containing "${field}"`, () => {
    const result = createOrderSchema.safeParse({ ...validBody, [field]: "PAID" });
    assert.equal(result.success, false);
  });
}

test("createOrderSchema rejects an attempt to smuggle payment fields into a line item", () => {
  const result = createOrderSchema.safeParse({
    ...validBody,
    lines: [{ ...validBody.lines[0], paymentStatus: "PAID" }],
  });
  assert.equal(result.success, false);
});

test("even a successful parse can never produce an object containing a payment field", () => {
  const result = createOrderSchema.safeParse(validBody);
  assert.equal(result.success, true);
  if (result.success) {
    for (const field of ["paymentStatus", "paymentMethod", "paidAt", "paidById"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(result.data, field), false);
    }
  }
});

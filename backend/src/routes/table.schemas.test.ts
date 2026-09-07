import assert from "node:assert/strict";
import test from "node:test";
import { qrSessionSchema } from "./table.schemas";

/**
 * Requirement: a customer must not be able to modify tableId/branchId to
 * change which table their session resolves to. The table/branch are
 * always resolved server-side from the QR token alone (see
 * table-session.service.ts); this test proves the request schema itself
 * rejects any attempt to smuggle those (or any other) fields into the
 * POST /api/public/table-session body before the route handler ever runs.
 */

const validToken = "a".repeat(43);

test("a well-formed QR-session body with only `token` parses successfully", () => {
  const result = qrSessionSchema.safeParse({ token: validToken });
  assert.equal(result.success, true);
});

for (const field of ["tableId", "branchId", "restaurantTableId", "id"] as const) {
  test(`qrSessionSchema rejects a request body containing "${field}" — tableId/branchId manipulation attempt`, () => {
    const result = qrSessionSchema.safeParse({ token: validToken, [field]: "11111111-1111-1111-1111-111111111111" });
    assert.equal(result.success, false);
  });
}

test("even a successful parse can never produce an object containing tableId or branchId", () => {
  const result = qrSessionSchema.safeParse({ token: validToken });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.data, "tableId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.data, "branchId"), false);
    assert.deepEqual(Object.keys(result.data), ["token"]);
  }
});

test("a token shorter than 43 characters (< 256 bits base64url) is rejected", () => {
  const result = qrSessionSchema.safeParse({ token: "short-token" });
  assert.equal(result.success, false);
});

test("a missing token is rejected", () => {
  const result = qrSessionSchema.safeParse({});
  assert.equal(result.success, false);
});

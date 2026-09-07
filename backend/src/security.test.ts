import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionOrderStatus } from "./services/order-state.service";
import { createOpaqueToken, hashToken } from "./security/tokens";

test("order state machine rejects skipping operational states", () => {
  assert.equal(canTransitionOrderStatus("RECEIVED", "CONFIRMED"), true);
  assert.equal(canTransitionOrderStatus("RECEIVED", "READY"), false);
  assert.equal(canTransitionOrderStatus("READY", "COMPLETED"), true);
  assert.equal(canTransitionOrderStatus("COMPLETED", "CANCELLED"), false);
});

test("opaque tokens have at least 256 bits and only hashes are stable", () => {
  const token = createOpaqueToken();
  assert.ok(token.length >= 43);
  assert.notEqual(hashToken(token), token);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(createOpaqueToken(), token);
});

import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAuditMetadata, AUDIT_ACTIONS } from "./audit.service";

test("audit action catalogue has no duplicate values", () => {
  const values = Object.values(AUDIT_ACTIONS);
  assert.equal(new Set(values).size, values.length);
});

test("sanitizeAuditMetadata redacts obviously forbidden keys", () => {
  const input = {
    password: "hunter2",
    passwordHash: "$2b$...",
    jwt: "eyJ...",
    cookie: "shrimelan_staff_session=abc",
    sessionToken: "raw-token-value",
    accessTokenHash: "abc123", // still redacted: matches /token/, even though this one is already a hash
    apiKey: "sk-live-...",
    Authorization: "Bearer abc",
    databaseUrl: "postgresql://user:pass@host/db",
    qrToken: "raw-qr-token",
  };
  const result = sanitizeAuditMetadata(input) as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    assert.equal(result[key], "[REDACTED]", `expected ${key} to be redacted`);
  }
});

test("sanitizeAuditMetadata redacts forbidden keys nested inside objects and arrays", () => {
  const input = {
    order: { id: "order-1", paymentMethod: "CASH" },
    attempts: [{ email: "a@b.com", password: "nope" }],
  };
  const result = sanitizeAuditMetadata(input) as any;
  assert.equal(result.order.id, "order-1");
  assert.equal(result.order.paymentMethod, "CASH");
  assert.equal(result.attempts[0].email, "a@b.com");
  assert.equal(result.attempts[0].password, "[REDACTED]");
});

test("sanitizeAuditMetadata preserves safe scalars and IDs untouched", () => {
  const input = {
    previousStatus: "RECEIVED",
    newStatus: "CONFIRMED",
    itemCount: 3,
    locked: true,
    tableId: "11111111-1111-1111-1111-111111111111",
  };
  assert.deepEqual(sanitizeAuditMetadata(input), input);
});

test("sanitizeAuditMetadata truncates long strings instead of dropping them", () => {
  const longValue = "x".repeat(1000);
  const result = sanitizeAuditMetadata({ note: longValue }) as Record<string, unknown>;
  assert.ok((result.note as string).length <= 501);
  assert.ok((result.note as string).endsWith("…"));
});

test("sanitizeAuditMetadata caps array length", () => {
  const bigArray = Array.from({ length: 200 }, (_, i) => i);
  const result = sanitizeAuditMetadata({ values: bigArray }) as { values: number[] };
  assert.equal(result.values.length, 50);
});

test("sanitizeAuditMetadata caps recursion depth instead of throwing on deep/cyclical-shaped input", () => {
  const deep = { a: { b: { c: { d: { e: { f: "too deep" } } } } } };
  const result = sanitizeAuditMetadata(deep) as any;
  assert.equal(result.a.b.c.d, "[TRUNCATED]");
});

test("sanitizeAuditMetadata never throws on null/undefined/unsupported values", () => {
  assert.equal(sanitizeAuditMetadata(null), null);
  assert.equal(sanitizeAuditMetadata(undefined), null);
  assert.equal(sanitizeAuditMetadata(10n), "[UNSUPPORTED]");
});

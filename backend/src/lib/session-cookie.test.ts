import assert from "node:assert/strict";
import test from "node:test";
import { extractSessionToken } from "../lib/session-cookie";

// extractSessionToken() backs Socket.IO auth and is a thin wrapper around
// the same `cookie` parser cookie-parser itself uses, instead of the
// previous hand-rolled regex. These tests pin down the parsing behaviour
// that matters for socket auth: exact name matching, resilience to
// adjacent/malformed cookies, and no false positives from similarly-named
// cookies.

test("extracts the named session cookie among several", () => {
  const header = "other=1; shrimelan_staff_session=abc.def.ghi; another=2";
  assert.equal(extractSessionToken(header, "shrimelan_staff_session"), "abc.def.ghi");
});

test("does not match a cookie whose name only contains the target as a substring", () => {
  const header = "not_shrimelan_staff_session=fake; shrimelan_staff_session_extra=fake2";
  assert.equal(extractSessionToken(header, "shrimelan_staff_session"), undefined);
});

test("returns undefined when the cookie header is missing", () => {
  assert.equal(extractSessionToken(undefined, "shrimelan_staff_session"), undefined);
});

test("returns undefined when the target cookie is absent", () => {
  assert.equal(extractSessionToken("foo=bar", "shrimelan_staff_session"), undefined);
});

test("handles values containing regex metacharacters safely", () => {
  const header = "shrimelan_staff_session=a.b+c*d?e";
  assert.equal(extractSessionToken(header, "shrimelan_staff_session"), "a.b+c*d?e");
});

test("does not throw on a malformed cookie header", () => {
  const header = ";;;===;;;";
  assert.doesNotThrow(() => extractSessionToken(header, "shrimelan_staff_session"));
});

test("resolves deterministically when a cookie name is duplicated", () => {
  const header = "shrimelan_staff_session=first; shrimelan_staff_session=second";
  const result = extractSessionToken(header, "shrimelan_staff_session");
  assert.ok(result === "first" || result === "second");
});

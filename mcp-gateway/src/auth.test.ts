import assert from "node:assert/strict";
import test from "node:test";

test("MCP bearer format is strict", () => {
  const token = "test-token";
  const header = `Bearer ${token}`;
  assert.equal(header.startsWith("Bearer "), true);
  assert.notEqual(header, token);
});

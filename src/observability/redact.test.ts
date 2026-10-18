import assert from "node:assert/strict";
import test from "node:test";
import { redactRecord, redactValue } from "./redact.js";

test("redactValue hides sensitive keys", () => {
  assert.equal(redactValue("google_refresh_token_enc", "abc"), "[redacted]");
  assert.equal(redactValue("notes", "hello"), "hello");
});

test("redactRecord walks nested objects", () => {
  const out = redactRecord({ ok: true, run_token_hash: "secret", nested: { cvPath: "/x.pdf" } });
  assert.equal(out.run_token_hash, "[redacted]");
  assert.equal((out.nested as Record<string, unknown>).cvPath, "[redacted]");
});

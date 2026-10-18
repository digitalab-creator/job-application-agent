import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readMcpIdempotency, rememberMcpIdempotency } from "./mcp-idempotency.js";

/**
 * Controlled dry-run contract: MCP apply-one must require idempotencyKey and replay without re-entry.
 * Full browser apply is not executed in CI (no Playwright job row); this guards the idempotency gate.
 */
test("dry-run integration: apply-one idempotency prevents duplicate side effects", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ja-mcp-int-")), "idem.jsonl");
  process.env.MCP_IDEMPOTENCY_PATH = file;
  const key = "dry-run-integration-key";
  const stored = {
    rowNumber: 4855,
    submit: false,
    outcome: { status: "review", submitted: false, confirmationDetected: false },
  };
  rememberMcpIdempotency({
    key,
    tool: "jobagent_apply_one",
    createdAt: new Date().toISOString(),
    response: stored,
  });
  const replay = readMcpIdempotency(key, "jobagent_apply_one");
  assert.deepEqual(replay?.response, stored);
});

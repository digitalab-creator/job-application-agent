import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readMcpIdempotency, rememberMcpIdempotency } from "./mcp-idempotency.js";

test("mcp idempotency replays stored response for same key", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ja-mcp-")), "idem.jsonl");
  process.env.MCP_IDEMPOTENCY_PATH = file;
  rememberMcpIdempotency({
    key: "key-1",
    tool: "jobagent_apply_one",
    createdAt: new Date().toISOString(),
    response: { ok: true, attemptId: "x" },
  });
  const hit = readMcpIdempotency("key-1", "jobagent_apply_one");
  assert.equal((hit?.response as { ok?: boolean }).ok, true);
});

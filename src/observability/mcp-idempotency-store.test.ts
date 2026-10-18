import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import {
  beginMcpIdempotency,
  computeMcpRequestFingerprint,
  finishMcpIdempotency,
} from "./mcp-idempotency-store.js";

const workspace = { id: "internal" } as WorkspaceRecord;

function scope(overrides: Partial<ReturnType<typeof baseScope>> = {}) {
  return { ...baseScope(), ...overrides };
}

function baseScope() {
  return {
    tool: "jobagent_apply_one",
    idempotencyKey: "idem-key-1",
    workspaceId: "internal",
    rowNumber: 100,
    submit: false,
    jobUrl: "https://example.com/j",
    company: "Acme",
    role: "Engineer",
  };
}

test("fingerprint changes when submit mode or job identity changes", () => {
  const a = computeMcpRequestFingerprint(scope());
  const b = computeMcpRequestFingerprint(scope({ submit: true }));
  const c = computeMcpRequestFingerprint(scope({ jobUrl: "https://example.com/other" }));
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("file-backed idempotency reserves and replays confirmed responses", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-idem-"));
  process.env.MCP_IDEMPOTENCY_PATH = path.join(dir, "idem.jsonl");
  const prevDb = process.env.WORKSPACE_DATABASE_URL;
  delete process.env.WORKSPACE_DATABASE_URL;

  const s = scope();
  const attemptId = "attempt-a";
  const first = await beginMcpIdempotency(workspace, s, attemptId);
  assert.equal(first.action, "proceed");

  await finishMcpIdempotency(s, attemptId, {
    state: "CONFIRMED",
    response: { ok: true, attemptId },
  });

  const replay = await beginMcpIdempotency(workspace, s, "other-attempt");
  assert.equal(replay.action, "replay");
  assert.deepEqual((replay as { response: Record<string, unknown> }).response, { ok: true, attemptId });

  if (prevDb) {
    process.env.WORKSPACE_DATABASE_URL = prevDb;
  }
});

test("rejects idempotency key reuse with different arguments", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-idem-2-"));
  process.env.MCP_IDEMPOTENCY_PATH = path.join(dir, "idem.jsonl");
  delete process.env.WORKSPACE_DATABASE_URL;

  const s = scope();
  await beginMcpIdempotency(workspace, s, "att-1");
  await finishMcpIdempotency(s, "att-1", { state: "FAILED" });

  const conflict = await beginMcpIdempotency(workspace, scope({ rowNumber: 101 }), "att-2");
  assert.equal(conflict.action, "reject");
  assert.match((conflict as { error: string }).error, /different_arguments/);
});

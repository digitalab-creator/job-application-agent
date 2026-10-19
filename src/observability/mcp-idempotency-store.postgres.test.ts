import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { ensureWorkspaceSchema, withDb } from "../orchestration/db.js";
import {
  beginMcpIdempotency,
  finishMcpIdempotency,
  type McpIdempotencyScope,
} from "./mcp-idempotency-store.js";

const dbUrl = process.env.MCP_IDEMPOTENCY_TEST_DATABASE_URL?.trim();
const workspace = { id: "internal" } as WorkspaceRecord;

function scope(overrides: Partial<McpIdempotencyScope> = {}): McpIdempotencyScope {
  return {
    tool: "jobagent_apply_one",
    idempotencyKey: `pg-test-${Date.now()}`,
    workspaceId: "internal",
    rowNumber: 42,
    submit: false,
    jobUrl: "https://example.com/j/1",
    company: "Acme",
    role: "Engineer",
    ...overrides,
  };
}

test("postgres idempotency: concurrent retries cannot both proceed", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
  await withDb(async (client) => {
    await client.query("DELETE FROM mcp_tool_idempotency");
  });
  const s = scope({ idempotencyKey: `pg-concurrent-${Date.now()}`, submit: false });
  const first = await beginMcpIdempotency(workspace, s, "attempt-1");
  assert.equal(first.action, "proceed");
  if (first.action !== "proceed") {
    return;
  }

  const second = await beginMcpIdempotency(workspace, s, "attempt-2");
  assert.equal(second.action, "wait");

  await finishMcpIdempotency(s, "attempt-1", { state: "FAILED" }, first.ownerToken);

  const [retryA, retryB] = await Promise.all([
    beginMcpIdempotency(workspace, s, "attempt-3"),
    beginMcpIdempotency(workspace, s, "attempt-4"),
  ]);
  const proceedCount = [retryA, retryB].filter((row) => row.action === "proceed").length;
  assert.equal(proceedCount, 1);
});

test("postgres idempotency: FAILED retry is atomic", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
  await withDb(async (client) => {
    await client.query("DELETE FROM mcp_tool_idempotency");
  });
  const s = scope({ idempotencyKey: `pg-failed-${Date.now()}`, submit: false });
  const started = await beginMcpIdempotency(workspace, s, "attempt-a");
  assert.equal(started.action, "proceed");
  if (started.action !== "proceed") {
    return;
  }
  await finishMcpIdempotency(s, "attempt-a", { state: "FAILED" }, started.ownerToken);
  const retry = await beginMcpIdempotency(workspace, s, "attempt-b");
  assert.equal(retry.action, "proceed");
  const blocked = await beginMcpIdempotency(workspace, s, "attempt-c");
  assert.equal(blocked.action, "wait");
});

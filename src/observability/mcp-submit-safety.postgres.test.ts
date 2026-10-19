import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { ensureWorkspaceSchema, withDb } from "../orchestration/db.js";
import {
  beginMcpIdempotency,
  confirmMcpIdempotencyLate,
  finishMcpIdempotency,
  recordMcpSubmissionStage,
  type McpIdempotencyScope,
} from "./mcp-idempotency-store.js";
import {
  claimCanonicalJobSubmitGuard,
  markCanonicalJobSubmitGuard,
} from "./canonical-job-submit-guard.js";

const dbUrl = process.env.MCP_IDEMPOTENCY_TEST_DATABASE_URL?.trim();
const workspace = { id: "internal" } as WorkspaceRecord;

async function resetSubmitSafetyTables(): Promise<void> {
  await withDb(async (client) => {
    await client.query("DELETE FROM canonical_job_submit_guard");
    await client.query("DELETE FROM mcp_tool_idempotency");
  });
}

function scope(overrides: Partial<McpIdempotencyScope> = {}): McpIdempotencyScope {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return {
    tool: "jobagent_apply_one",
    idempotencyKey: `pg-safety-${suffix}`,
    workspaceId: "internal",
    rowNumber: 42,
    submit: true,
    jobUrl: `https://boards.greenhouse.io/acme/jobs/${suffix}`,
    company: "Acme",
    role: "Engineer",
    ...overrides,
  };
}

test("postgres safety: schema ready", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
});

test("postgres safety: same idempotency key concurrent single proceed", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
  await resetSubmitSafetyTables();
  const s = scope({ idempotencyKey: `pg-same-key-${Date.now()}` });
  const first = await beginMcpIdempotency(workspace, s, "attempt-1");
  assert.equal(first.action, "proceed");
  const second = await beginMcpIdempotency(workspace, s, "attempt-2");
  assert.equal(second.action, "wait");
});

test("postgres safety: different keys same job second submit blocked", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
  await resetSubmitSafetyTables();
  const jobUrl = `https://boards.greenhouse.io/acme/jobs/dup-${Date.now()}`;
  const a = scope({ idempotencyKey: `key-a-${Date.now()}`, jobUrl });
  const b = scope({ idempotencyKey: `key-b-${Date.now()}`, jobUrl });
  const first = await beginMcpIdempotency(workspace, a, "attempt-a");
  assert.equal(first.action, "proceed");
  if (first.action !== "proceed") {
    return;
  }
  const guard = await claimCanonicalJobSubmitGuard({
    workspaceId: "internal",
    jobUrl,
    attemptId: first.attemptId,
    ownerToken: first.ownerToken,
    idempotencyKey: a.idempotencyKey,
  });
  assert.equal(guard.ok, true);
  const second = await beginMcpIdempotency(workspace, b, "attempt-b");
  assert.equal(second.action, "reject");
  assert.match((second as { error: string }).error, /canonical_job_submit_already_active|prior_submission/);
});

test("postgres safety: stale IN_PROGRESS after post_submit cannot retry", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
  await resetSubmitSafetyTables();
  const s = scope({ idempotencyKey: `pg-stale-submit-${Date.now()}` });
  const first = await beginMcpIdempotency(workspace, s, "attempt-crash");
  assert.equal(first.action, "proceed");
  if (first.action !== "proceed") {
    return;
  }
  await recordMcpSubmissionStage(s, first.attemptId, first.ownerToken, "post_submit_click");
  const retry = await beginMcpIdempotency(workspace, s, "attempt-retry-45m");
  assert.equal(retry.action, "reject");
  assert.equal((retry as { state?: string }).state, "UNKNOWN");
});

test("postgres safety: late confirmation promotes uncertain to replay", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
  await resetSubmitSafetyTables();
  const s = scope({ idempotencyKey: `pg-late-confirm-${Date.now()}` });
  const first = await beginMcpIdempotency(workspace, s, "attempt-late");
  assert.equal(first.action, "proceed");
  if (first.action !== "proceed") {
    return;
  }
  await recordMcpSubmissionStage(s, first.attemptId, first.ownerToken, "post_submit_click");
  await finishMcpIdempotency(s, first.attemptId, { state: "UNKNOWN" }, first.ownerToken);
  const promoted = await confirmMcpIdempotencyLate(
    s,
    first.attemptId,
    { ok: true, attemptId: first.attemptId },
    first.ownerToken,
  );
  assert.equal(promoted, true);
  const replay = await beginMcpIdempotency(workspace, s, "replay");
  assert.equal(replay.action, "replay");
});

test("postgres safety: scheduler and MCP guard compete for one job", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
  await resetSubmitSafetyTables();
  const jobUrl = `https://boards.greenhouse.io/acme/jobs/sched-${Date.now()}`;
  const schedulerAttempt = "scheduler-attempt";
  const schedulerToken = "scheduler-token";
  const mcpAttempt = "mcp-attempt";
  const mcpToken = "mcp-token";
  const claimedScheduler = await claimCanonicalJobSubmitGuard({
    workspaceId: "internal",
    jobUrl,
    attemptId: schedulerAttempt,
    ownerToken: schedulerToken,
  });
  assert.equal(claimedScheduler.ok, true);
  const claimedMcp = await claimCanonicalJobSubmitGuard({
    workspaceId: "internal",
    jobUrl,
    attemptId: mcpAttempt,
    ownerToken: mcpToken,
  });
  assert.equal(claimedMcp.ok, false);
  await markCanonicalJobSubmitGuard("internal", jobUrl, schedulerAttempt, schedulerToken, "RELEASED");
  const reclaimed = await claimCanonicalJobSubmitGuard({
    workspaceId: "internal",
    jobUrl,
    attemptId: mcpAttempt,
    ownerToken: mcpToken,
  });
  assert.equal(reclaimed.ok, true);
});

test("postgres safety: fingerprint mismatch rejects reuse", { skip: !dbUrl }, async () => {
  process.env.WORKSPACE_DATABASE_URL = dbUrl;
  await ensureWorkspaceSchema();
  await resetSubmitSafetyTables();
  const key = `pg-fingerprint-${Date.now()}`;
  const s1 = scope({ idempotencyKey: key, jobUrl: `https://boards.greenhouse.io/acme/jobs/fp-${Date.now()}` });
  const started = await beginMcpIdempotency(workspace, s1, "att-1");
  assert.equal(started.action, "proceed");
  if (started.action !== "proceed") {
    return;
  }
  await finishMcpIdempotency(s1, "att-1", { state: "FAILED" }, started.ownerToken);
  const s2 = scope({ idempotencyKey: key, rowNumber: 99 });
  const conflict = await beginMcpIdempotency(workspace, s2, "att-2");
  assert.equal(conflict.action, "reject");
  assert.match((conflict as { error: string }).error, /different_arguments/);
});

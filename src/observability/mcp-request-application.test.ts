import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { MCP_REQUEST_APPLICATION_TOOL } from "./mcp-tools.js";
import { findJobSheetRow } from "./job-sheet-lookup.js";
import { beginMcpIdempotency, finishMcpIdempotency } from "./mcp-idempotency-store.js";

const workspace = { id: "internal" } as WorkspaceRecord;

test("findJobSheetRow resolves canonical posting key", () => {
  const rows = [{ row_number: 10, Company: "Acme", Role: "Eng", "Job URL": "https://boards.greenhouse.io/acme/jobs/1" }];
  const hit = findJobSheetRow(rows, { canonicalJobId: "greenhouse:acme:1" });
  assert.equal(hit?.row_number, 10);
});

test("file idempotency replays request-application accepted payload", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-mcp-req-"));
  process.env.MCP_IDEMPOTENCY_PATH = path.join(dir, "idem.jsonl");
  delete process.env.WORKSPACE_DATABASE_URL;

  const scope = {
    tool: MCP_REQUEST_APPLICATION_TOOL,
    idempotencyKey: "req-key-1",
    workspaceId: "internal",
    rowNumber: 55,
    submit: true,
    jobUrl: "https://boards.greenhouse.io/acme/jobs/99",
    company: "Acme",
    role: "Eng",
  };
  const attemptId = "attempt-req-1";
  const first = await beginMcpIdempotency(workspace, scope, attemptId);
  assert.equal(first.action, "proceed");
  const accepted = { attemptId, status: "queued", rowNumber: 55, submit: true };
  await finishMcpIdempotency(scope, attemptId, { state: "CONFIRMED", response: accepted });

  const replay = await beginMcpIdempotency(workspace, scope, "other");
  assert.equal(replay.action, "replay");
  assert.deepEqual((replay as { response: Record<string, unknown> }).response, accepted);
});

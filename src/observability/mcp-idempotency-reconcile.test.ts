import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { reconcileSubmitAttempt } from "./mcp-idempotency-reconcile.js";
import type { ApplyAttemptRecord } from "../models/types.js";

const workspace = { id: "internal" } as WorkspaceRecord;

function attempt(partial: Partial<ApplyAttemptRecord> & { attemptId: string }): ApplyAttemptRecord {
  return {
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    company: "Acme",
    role: "Engineer",
    originalJobUrl: "https://boards.greenhouse.io/acme/jobs/1",
    outcome: "in_progress",
    submitted: false,
    confirmationDetected: false,
    pipeline: {
      urlValidated: true,
      opened: true,
      recovered: false,
      fitPassed: true,
      cvGenerated: true,
      cvQualityPassed: true,
      submitted: false,
      confirmed: false,
    },
    notes: "stage=started",
    ...partial,
  };
}

test("reconcile: post_submit_click is always uncertain", () => {
  assert.equal(
    reconcileSubmitAttempt({
      attemptId: "a1",
      workspace,
      submissionStage: "post_submit_click",
    }),
    "UNKNOWN",
  );
});

test("reconcile: missing ledger is uncertain not failed-safe", () => {
  assert.equal(
    reconcileSubmitAttempt({ attemptId: "missing", workspace }),
    "UNKNOWN",
  );
});

test("reconcile: in_progress without submit stage is failed-safe", () => {
  process.env.APPLY_ATTEMPTS_PATH = "/tmp/ja-reconcile-test-nonexistent.jsonl";
  const id = "in-progress-only";
  const file = process.env.APPLY_ATTEMPTS_PATH;
  fs.writeFileSync(
    file,
    `${JSON.stringify(attempt({ attemptId: id, outcome: "in_progress" }))}\n`,
    "utf8",
  );
  assert.equal(reconcileSubmitAttempt({ attemptId: id, workspace }), "FAILED_SAFE");
  fs.unlinkSync(file);
});

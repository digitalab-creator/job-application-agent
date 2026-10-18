import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectApplyAttemptLedgerPaths,
  findAttemptInLedgers,
  mergeAttemptRecords,
} from "./attempt-sources.js";

test("mergeAttemptRecords keeps latest finishedAt per attemptId", () => {
  const merged = mergeAttemptRecords([
    {
      attemptId: "a1",
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:01:00Z",
      company: "A",
      role: "R",
      originalJobUrl: "https://x",
      outcome: "request_failed",
      notes: "test",
      submitted: false,
      confirmationDetected: false,
      pipeline: {
        urlValidated: false,
        opened: false,
        recovered: false,
        fitPassed: false,
        cvGenerated: false,
        cvQualityPassed: false,
        submitted: false,
        confirmed: false,
      },
    },
    {
      attemptId: "a1",
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-02T00:01:00Z",
      company: "A",
      role: "R",
      originalJobUrl: "https://x",
      outcome: "applied",
      notes: "test",
      submitted: true,
      confirmationDetected: true,
      pipeline: {
        urlValidated: true,
        opened: true,
        recovered: false,
        fitPassed: true,
        cvGenerated: true,
        cvQualityPassed: true,
        submitted: true,
        confirmed: true,
      },
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.outcome, "applied");
});

test("findAttemptInLedgers reads workspace internal ledger path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-ledger-"));
  const internal = path.join(dir, "internal", "apply-attempts.jsonl");
  fs.mkdirSync(path.dirname(internal), { recursive: true });
  const attemptId = "425fc404-aab0-48b0-950d-56c2b68e1d81";
  fs.writeFileSync(
    internal,
    `${JSON.stringify({
      attemptId,
      startedAt: "2026-10-17T06:02:06.898Z",
      finishedAt: "2026-10-17T06:02:29.558Z",
      company: "Financial company",
      role: "System Manager",
      originalJobUrl: "https://www.sqlink.com/career/",
      outcome: "request_failed",
      notes: "test",
      submitted: false,
      confirmationDetected: false,
      pipeline: {
        urlValidated: true,
        opened: true,
        recovered: false,
        fitPassed: false,
        cvGenerated: false,
        cvQualityPassed: false,
        submitted: false,
        confirmed: false,
      },
    })}\n`,
  );
  const workspace = {
    id: "internal",
    applyAttemptsPath: internal,
  } as import("../orchestration/workspace-types.js").WorkspaceRecord;
  const paths = collectApplyAttemptLedgerPaths(workspace);
  assert.ok(paths.includes(internal));
  const { record } = findAttemptInLedgers(attemptId, workspace);
  assert.equal(record?.attemptId, attemptId);
});

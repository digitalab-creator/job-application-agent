import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ApplyAttemptRecord } from "../models/types.js";
import { rememberAttemptOutcome } from "./attempt-ledger.js";

test("confirmed outcome cannot be overwritten by a later technical failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attempt-ledger-"));
  const previous = process.env.APPLY_ATTEMPTS_PATH;
  process.env.APPLY_ATTEMPTS_PATH = path.join(dir, "apply-attempts.jsonl");
  const base: ApplyAttemptRecord = {
    attemptId: "attempt-1",
    startedAt: "2026-10-05T07:00:00.000Z",
    finishedAt: "2026-10-05T07:01:00.000Z",
    company: "Example",
    role: "Backend Engineer",
    originalJobUrl: "https://example.test/jobs/1",
    outcome: "applied",
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
    notes: "confirmed",
  };
  try {
    rememberAttemptOutcome(base);
    const retained = rememberAttemptOutcome({ ...base, outcome: "navigation_failed", confirmationDetected: false });
    assert.equal(retained.outcome, "applied");
    const rows = fs.readFileSync(process.env.APPLY_ATTEMPTS_PATH, "utf8").trim().split("\n");
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0]!).outcome, "applied");
  } finally {
    if (previous === undefined) delete process.env.APPLY_ATTEMPTS_PATH;
    else process.env.APPLY_ATTEMPTS_PATH = previous;
  }
});

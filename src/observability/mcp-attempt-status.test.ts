import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { resolveMcpAttemptStatus } from "./mcp-attempt-status.js";
import { rememberAttemptOutcome, attemptRecordFromResult } from "../application/attempt-ledger.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workspace = { id: "internal" } as WorkspaceRecord;

test("attempt status maps confirmed ledger outcome", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-att-status-"));
  process.env.APPLY_ATTEMPTS_PATH = path.join(dir, "apply-attempts.jsonl");
  const attemptId = "11111111-1111-4111-8111-111111111111";
  rememberAttemptOutcome(
    attemptRecordFromResult(
      {
        attemptId,
        startedAt: new Date().toISOString(),
        company: "Acme",
        role: "Eng",
        url: "https://boards.greenhouse.io/acme/jobs/1",
        workspaceId: "internal",
      },
      {
        status: "applied",
        jobUrl: "https://boards.greenhouse.io/acme/jobs/1",
        submitted: true,
        confirmationDetected: true,
        terminalOutcome: "applied",
        notes: "result=applied",
      },
    ),
  );
  const status = await resolveMcpAttemptStatus(attemptId, workspace);
  assert.equal(status.status, "confirmed");
  assert.equal(status.confirmationDetected, true);
});

test("attempt status surfaces otp diagnostic without secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-att-otp-"));
  process.env.APPLY_ATTEMPTS_PATH = path.join(dir, "apply-attempts.jsonl");
  const attemptId = "22222222-2222-4222-8222-222222222222";
  rememberAttemptOutcome(
    attemptRecordFromResult(
      {
        attemptId,
        startedAt: new Date().toISOString(),
        company: "Acme",
        role: "Eng",
        url: "https://boards.greenhouse.io/acme/jobs/2",
        workspaceId: "internal",
      },
      {
        status: "review",
        jobUrl: "https://boards.greenhouse.io/acme/jobs/2",
        submitted: true,
        confirmationDetected: false,
        blocker: "email_verification_required",
        notes: "otp_failure=gmail_authorization_failed\nNo token",
      },
    ),
  );
  const status = await resolveMcpAttemptStatus(attemptId, workspace);
  assert.equal(status.status, "blocked");
  assert.equal(status.otpDiagnostic, "gmail_authorization_failed");
  assert.equal(String(status.evidence?.pipeline ?? "").includes("AB12"), false);
});

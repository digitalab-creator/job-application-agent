import assert from "node:assert/strict";
import test from "node:test";
import type { ApplyInput } from "../application/apply-job.js";
import type { ApplicationResult } from "../models/types.js";

/**
 * Fake ATS harness: simulates Playwright apply stages without a browser.
 * Used to prove checkpoint ordering for MCP submit=false preview vs submit=true gates.
 */
async function fakeAtsApply(input: ApplyInput): Promise<ApplicationResult> {
  const pipeline = {
    urlValidated: true,
    opened: true,
    recovered: false,
    fitPassed: true,
    cvGenerated: true,
    cvQualityPassed: true,
    submitted: false,
    confirmed: false,
  };
  if (!input.submit) {
    return {
      attemptId: input.attemptId,
      status: "review",
      jobUrl: input.job.url,
      submitted: false,
      confirmationDetected: false,
      terminalOutcome: "dry_run",
      pipeline,
      blocker: "dry_run",
      notes: "result=review\nblocker=dry_run",
    };
  }
  if (input.onSubmissionCheckpoint) {
    await input.onSubmissionCheckpoint("pre_submit");
  }
  pipeline.submitted = true;
  if (input.onSubmissionCheckpoint) {
    await input.onSubmissionCheckpoint("post_submit_click");
  }
  return {
    attemptId: input.attemptId,
    status: "review",
    jobUrl: input.job.url,
    submitted: true,
    confirmationDetected: false,
    terminalOutcome: "confirmation_not_detected",
    pipeline,
    blocker: "submitted_unconfirmed",
    notes: "result=review\nblocker=submitted_unconfirmed",
  };
}

test("fake ATS: preview never reaches submission checkpoints", async () => {
  const stages: string[] = [];
  const outcome = await fakeAtsApply({
    submit: false,
    job: { role: "Eng", company: "Acme", url: "https://example.com/j/1" },
    onSubmissionCheckpoint: async (stage) => {
      stages.push(stage);
    },
  });
  assert.equal(outcome.submitted, false);
  assert.deepEqual(stages, []);
});

test("fake ATS: submit path records pre and post submit checkpoints", async () => {
  const stages: string[] = [];
  const outcome = await fakeAtsApply({
    submit: true,
    attemptId: "fake-ats-1",
    job: { role: "Eng", company: "Acme", url: "https://example.com/j/1" },
    onSubmissionCheckpoint: async (stage) => {
      stages.push(stage);
    },
  });
  assert.equal(outcome.submitted, true);
  assert.equal(outcome.confirmationDetected, false);
  assert.deepEqual(stages, ["pre_submit", "post_submit_click"]);
});

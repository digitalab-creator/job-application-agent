import assert from "node:assert/strict";
import test from "node:test";
import type { LedgerEntry } from "./ledger-policy.js";

const gfJobA = "https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/154895/";
const gfJobB = "https://www.gotfriends.co.il/jobslobby/ai/llm-engineer/151469/";

async function loadDedup() {
  process.env.APPLY_API_TOKEN ??= "unit-test-token";
  process.env.TECHNICAL_CV_PATH ??= "/tmp/technical-cv.pdf";
  process.env.MARKETING_CV_PATH ??= "/tmp/marketing-cv.pdf";
  process.env.LLM_API_KEY ??= "unit-test-llm-key";
  return import("./submission-dedup.js");
}

test("three GotFriends listings share registration dedup but keep distinct job keys", async () => {
  const { shouldSkipApplyForScopeDedup } = await loadDedup();
  const entries: LedgerEntry[] = [
    {
      url: gfJobA,
      company: "GotFriends",
      role: "AI Engineer",
      confirmationDetected: true,
      at: "2026-10-10T10:00:00.000Z",
      submissionScope: "agency_registration",
      agencyId: "gotfriends.co.il",
      dedupKey: "agency_reg:internal:gotfriends.co.il",
    },
  ];
  assert.equal(shouldSkipApplyForScopeDedup(gfJobA, "internal", entries).skip, false);
  assert.equal(shouldSkipApplyForScopeDedup(gfJobB, "internal", entries).skip, false);
  assert.equal(
    shouldSkipApplyForScopeDedup(
      "https://www.gotfriends.co.il/jobslobby/ai/",
      "internal",
      entries,
    ).skip,
    true,
  );
});

test("confirmed job interest blocks repeat for same posting only", async () => {
  const { shouldSkipApplyForScopeDedup } = await loadDedup();
  const entries: LedgerEntry[] = [
    {
      url: gfJobA,
      company: "Cyber startup",
      role: "AI Engineer",
      confirmationDetected: true,
      at: "2026-10-10T11:00:00.000Z",
      submissionScope: "agency_job_interest",
      agencyId: "gotfriends.co.il",
      postingId: "154895",
      dedupKey: "agency_job:internal:gotfriends.co.il:154895",
    },
  ];
  assert.equal(shouldSkipApplyForScopeDedup(gfJobA, "internal", entries).skip, true);
  assert.equal(shouldSkipApplyForScopeDedup(gfJobB, "internal", entries).skip, false);
});

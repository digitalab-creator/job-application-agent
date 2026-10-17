import assert from "node:assert/strict";
import test from "node:test";
import { evaluateJobUrlEligibility, isSpecificEmployerJobUrl } from "./job-url-eligibility.js";

/** Regression: Jobs!4750 — GotFriends search-results hub, not a posting. */
const JOBS_4750_URL = "https://www.gotfriends.co.il/jobslobby/ai/?page=1&total=11";

test("Jobs!4750 GotFriends search page is not a specific employer job URL", () => {
  assert.equal(isSpecificEmployerJobUrl(JOBS_4750_URL), false);
  const verdict = evaluateJobUrlEligibility(JOBS_4750_URL);
  assert.equal(verdict.specific, false);
  assert.equal(verdict.automatable, false);
  assert.equal(verdict.rejectReason, "non_specific_posting");
});

test("GotFriends posting with numeric id stays specific and resolvable", () => {
  const url = "https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/154895/";
  assert.equal(isSpecificEmployerJobUrl(url), true);
  const verdict = evaluateJobUrlEligibility(url);
  assert.equal(verdict.specific, true);
  assert.equal(verdict.capability, "resolvable");
});

test("Greenhouse posting stays automatable", () => {
  const url = "https://boards.greenhouse.io/acme/jobs/123456";
  const verdict = evaluateJobUrlEligibility(url);
  assert.equal(verdict.specific, true);
  assert.equal(verdict.automatable, true);
});

test("Drushim category hub is not a specific posting", () => {
  const url = "https://www.drushim.co.il/jobs/category/marketing/";
  assert.equal(isSpecificEmployerJobUrl(url), false);
});

test("JobMaster search listing is not a specific posting", () => {
  const url = "https://www.jobmaster.co.il/jobs//q-PPC/l-2026/";
  assert.equal(isSpecificEmployerJobUrl(url), false);
  assert.equal(evaluateJobUrlEligibility(url).rejectReason, "non_specific_posting");
});

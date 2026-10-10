import assert from "node:assert/strict";
import test from "node:test";
import { classifyPostingContent } from "./posting-content-quality.js";

test("Cloudflare block is access_blocked, not fit input", () => {
  const verdict = classifyPostingContent(
    "Sorry, you have been blocked. Cloudflare Ray ID: abc. Checking your browser before accessing.",
    "https://www.sqlink.com/career/foo",
  );
  assert.equal(verdict.kind, "access_blocked");
});

test("Jobmaster search URL is search_results", () => {
  const verdict = classifyPostingContent(
    "Some PPC jobs in Israel",
    "https://www.jobmaster.co.il/jobs//q-PPC/l-2026/",
  );
  assert.equal(verdict.kind, "search_results");
});

test("Valid JD snippet passes", () => {
  const jd = `
Senior AI Engineer
Responsibilities: build production LLM systems.
Requirements: 5+ years backend, Python, APIs.
Apply now.
`.repeat(3);
  const verdict = classifyPostingContent(jd, "https://boards.greenhouse.io/acme/jobs/1");
  assert.equal(verdict.kind, "ok");
});

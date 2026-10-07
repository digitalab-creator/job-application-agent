import assert from "node:assert/strict";
import test from "node:test";
import { greenhouseTarget, redirectedAwayReason, registrableDomain } from "./posting-gone.js";

test("greenhouse posting URLs expose slug and job id", () => {
  assert.deepEqual(greenhouseTarget("https://boards.greenhouse.io/appsflyer/jobs/5471204"), {
    apiHost: "boards-api.greenhouse.io", slug: "appsflyer", jobId: "5471204",
  });
  assert.deepEqual(greenhouseTarget("https://job-boards.greenhouse.io/embed/job_app?for=taboola&token=8236852"), {
    apiHost: "boards-api.greenhouse.io", slug: "taboola", jobId: "8236852",
  });
  assert.equal(greenhouseTarget("https://job-boards.eu.greenhouse.io/acme/jobs/1")?.apiHost, "boards-api.eu.greenhouse.io");
});

test("non-greenhouse URLs are not checked against the greenhouse API", () => {
  assert.equal(greenhouseTarget("https://www.axonius.com/company/careers/open-jobs?gh_jid=7995553003"), null);
  assert.equal(greenhouseTarget("https://apply.workable.com/acme/j/ABC123/"), null);
});

test("posting URL that lands on the site root is gone", () => {
  assert.equal(redirectedAwayReason("https://boards.greenhouse.io/appsflyer/jobs/5471204", "http://careers.appsflyer.com/"), "redirected_to_home");
});

test("company page redirected to an unrelated product site is gone", () => {
  assert.equal(
    redirectedAwayReason("https://databee.com/careers/full-stack-ai-engineer-remote-IL", "https://www.red-gate.com/products/data-masker/"),
    "redirected_away:red-gate.com",
  );
});

test("ATS hand-offs and same-site moves are not treated as gone", () => {
  assert.equal(redirectedAwayReason("https://www.taboola.com/careers/job/8236852?gh_jid=8236852", "https://job-boards.greenhouse.io/taboola/jobs/8236852"), null);
  assert.equal(redirectedAwayReason("https://example.com/careers/job-1", "https://example.com/careers/job-1/apply"), null);
  assert.equal(redirectedAwayReason("https://example.com/", "https://example.com/"), null);
});

test("registrableDomain handles co.il style suffixes", () => {
  assert.equal(registrableDomain("www.jobmaster.co.il"), "jobmaster.co.il");
  assert.equal(registrableDomain("careers.appsflyer.com"), "appsflyer.com");
});

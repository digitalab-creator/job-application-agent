import assert from "node:assert/strict";
import test from "node:test";
import { extractHttpUrlFromCell, isAutomatableApplyUrl, parseHttpUrl } from "./automatable-url.js";

test("Comeet, Workable, LinkedIn, and company career pages are attempted", () => {
  assert.equal(
    isAutomatableApplyUrl("https://www.comeet.com/jobs/fetcherr/68.006/data-scientist/AA.11"),
    true,
  );
  assert.equal(
    isAutomatableApplyUrl("https://apply.workable.com/peecan/j/CA2364CE1E/"),
    true,
  );
  assert.equal(isAutomatableApplyUrl("https://www.linkedin.com/jobs/view/4452822089/"), true);
  assert.equal(isAutomatableApplyUrl("https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/154895/"), true);
  assert.equal(isAutomatableApplyUrl("https://boards.greenhouse.io/example/jobs/1"), true);
});

test("empty links and known junk placeholders are skipped", () => {
  assert.equal(isAutomatableApplyUrl(""), false);
  assert.equal(isAutomatableApplyUrl("not a url"), false);
  assert.equal(
    isAutomatableApplyUrl("https://apply.workable.com/comeet/j/healthtech-growth-lead-tlv"),
    false,
  );
  assert.equal(
    isAutomatableApplyUrl("https://www.comeet.com/jobs/stampli/F6.007/0B.273"),
    false,
  );
});

test("URL validation rejects malformed and non-web schemes before navigation", () => {
  assert.equal(parseHttpUrl("javascript:alert(1)"), null);
  assert.equal(parseHttpUrl("https://"), null);
  const parsed = parseHttpUrl("https://jobs.example/apply");
  assert.ok(parsed);
  assert.equal(parsed.hostname, "jobs.example");
});

test("extractHttpUrlFromCell pulls URL before trailing notes", () => {
  const url = extractHttpUrlFromCell(
    "https://boards.greenhouse.io/acme/jobs/1 see also company site",
  );
  assert.equal(url, "https://boards.greenhouse.io/acme/jobs/1");
});

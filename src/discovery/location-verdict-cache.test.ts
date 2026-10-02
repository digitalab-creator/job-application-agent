import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getCachedLocationVerdict,
  locationCacheKey,
  setCachedLocationVerdict,
} from "./location-verdict-cache.js";

test("location cache key prefers job URL pathname", () => {
  assert.equal(
    locationCacheKey("https://www.comeet.com/jobs/foo/bar/role/AA.11"),
    "/jobs/foo/bar/role/aa.11",
  );
});

test("location cache key keeps gh_jid so postings sharing one path stay separate", () => {
  const lisbon = locationCacheKey("https://www.riskified.com/job-description/?gh_jid=8831790002");
  const telAviv = locationCacheKey("https://www.riskified.com/job-description/?gh_jid=8805197002");
  assert.equal(telAviv, "/job-description?gh_jid=8805197002");
  assert.notEqual(lisbon, telAviv);
});

test("cached verdict round-trips on disk by job URL key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loc-cache-"));
  const filePath = path.join(dir, "location-verdicts.json");
  process.env.LOCATION_VERDICT_CACHE_PATH = filePath;
  const key = locationCacheKey("https://example.com/jobs/abc/role", "Mystery Israel Role");
  setCachedLocationVerdict(key, {
    eligible: true,
    source: "llm_search",
    reason: "cached_test",
  });
  assert.equal(getCachedLocationVerdict(key)?.eligible, true);
  assert.equal(getCachedLocationVerdict(key)?.reason, "cached_test");
  delete process.env.LOCATION_VERDICT_CACHE_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

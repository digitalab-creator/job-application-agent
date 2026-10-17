import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPostingKey, uniqueKeyForUrl } from "./job-posting-identity.js";

test("Yotpo greenhouse board URL and company gid URL share one posting key", () => {
  const board = "https://boards.greenhouse.io/yotpo/jobs/7633905";
  const careers = "https://www.yotpo.com/careers/gid-7633905/";
  assert.equal(canonicalPostingKey(board), "greenhouse:yotpo:7633905");
  assert.equal(canonicalPostingKey(careers), "greenhouse:yotpo:7633905");
  assert.equal(uniqueKeyForUrl(board), uniqueKeyForUrl(careers));
});

test("repeated Yotpo Director of Data URLs dedupe to one greenhouse key", () => {
  const urls = [
    "https://boards.greenhouse.io/yotpo/jobs/8211515",
    "https://www.yotpo.com/careers/gid-8211515/",
    "https://job-boards.greenhouse.io/yotpo/jobs/8211515",
  ];
  const keys = new Set(urls.map((url) => uniqueKeyForUrl(url)));
  assert.equal(keys.size, 1);
  assert.equal(keys.values().next().value, "greenhouse:yotpo:8211515");
});

test("equivalent Greenhouse gh_jid and boards job path share a key", () => {
  const a = "https://www.riskified.com/job-description/?gh_jid=8805197002";
  const b = "https://boards.greenhouse.io/riskified/jobs/8805197002";
  assert.equal(uniqueKeyForUrl(a), uniqueKeyForUrl(b));
});

test("distinct GotFriends postings stay distinct", () => {
  const a = uniqueKeyForUrl("https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/154895/");
  const b = uniqueKeyForUrl("https://www.gotfriends.co.il/jobslobby/ai/llm-engineer/151469/");
  assert.notEqual(a, b);
  assert.match(a, /^gotfriends:154895$/);
});

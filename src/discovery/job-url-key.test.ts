import assert from "node:assert/strict";
import test from "node:test";
import { uniqueKeyForUrl } from "./job-url-key.js";

test("uniqueKeyForUrl includes hostname to avoid cross-domain path collisions", () => {
  const a = uniqueKeyForUrl("https://jobs.example.com/careers/123");
  const b = uniqueKeyForUrl("https://other.example.org/careers/123");
  assert.notEqual(a, b);
  assert.match(a, /^jobs\.example\.com/);
});

test("Greenhouse gh_jid is preserved on company career pages", () => {
  const key = uniqueKeyForUrl("https://boards.example.com/careers/open?gh_jid=99");
  assert.match(key, /gh_jid=99/);
});

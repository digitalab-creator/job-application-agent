import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJobNavigationUrl, navigationRetryUrls } from "./job-navigation-url.js";

test("normalizeJobNavigationUrl adds trailing slash on WordPress careers slug", () => {
  const raw = "https://orca.security/about/careers/6161068004?gh_jid=6161068004";
  assert.equal(
    normalizeJobNavigationUrl(raw),
    "https://orca.security/about/careers/6161068004/?gh_jid=6161068004",
  );
});

test("navigationRetryUrls dedupes identical urls", () => {
  const urls = navigationRetryUrls("https://example.com/jobs/1/");
  assert.deepEqual(urls, ["https://example.com/jobs/1/"]);
});

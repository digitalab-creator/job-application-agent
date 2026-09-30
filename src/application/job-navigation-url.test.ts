import assert from "node:assert/strict";
import test from "node:test";
import { directGreenhouseUrlsForCareersUrl, greenhouseBoardUrls, normalizeJobNavigationUrl, navigationRetryUrls } from "./job-navigation-url.js";

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

test("gh_jid career URL also opens the Greenhouse board posting", () => {
  const urls = greenhouseBoardUrls("https://www.axonius.com/company/careers/open-jobs?gh_jid=7995553003");
  assert.deepEqual(urls, [
    "https://job-boards.greenhouse.io/embed/job_app?for=axonius&token=7995553003",
    "https://job-boards.greenhouse.io/axonius/jobs/7995553003",
    "https://boards.greenhouse.io/axonius/jobs/7995553003",
  ]);
  assert.equal(navigationRetryUrls("https://www.axonius.com/company/careers/open-jobs?gh_jid=7995553003")[0], urls[0]);
});

test("Wix position URL can fall back to the Greenhouse board posting", () => {
  const urls = directGreenhouseUrlsForCareersUrl("https://careers.wix.com/location/tel-aviv/positions/10022791");
  assert.deepEqual(urls[1], "https://job-boards.greenhouse.io/wix/jobs/10022791");
  assert.ok(navigationRetryUrls("https://careers.wix.com/location/tel-aviv/positions/10022791").includes(urls[1]!));
});

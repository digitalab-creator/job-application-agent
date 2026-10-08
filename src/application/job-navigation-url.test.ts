import assert from "node:assert/strict";
import test from "node:test";
import { directGreenhouseUrlsForCareersUrl, greenhouseBoardUrls, greenhouseJobPostUrls, normalizeJobNavigationUrl, navigationRetryUrls } from "./job-navigation-url.js";

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
  ]);
  assert.equal(navigationRetryUrls("https://www.axonius.com/company/careers/open-jobs?gh_jid=7995553003")[0], urls[0]);
});

test("legacy boards.greenhouse.io job links resolve to job-boards embed first", () => {
  const urls = greenhouseJobPostUrls("https://boards.greenhouse.io/appsflyer/jobs/5471204");
  assert.equal(urls[0], "https://job-boards.greenhouse.io/embed/job_app?for=appsflyer&token=5471204");
  assert.equal(navigationRetryUrls("https://boards.greenhouse.io/appsflyer/jobs/5471204")[0], urls[0]);
});

test("payoneer embed token URLs stay on job-boards", () => {
  const urls = greenhouseJobPostUrls("https://job-boards.greenhouse.io/embed/job_app?for=payoneer&token=8185354");
  assert.equal(urls[0], "https://job-boards.greenhouse.io/embed/job_app?for=payoneer&token=8185354");
});

test("Wix position URL can fall back to the Greenhouse board posting", () => {
  const urls = directGreenhouseUrlsForCareersUrl("https://careers.wix.com/location/tel-aviv/positions/10022791");
  assert.deepEqual(urls[1], "https://job-boards.greenhouse.io/wix/jobs/10022791");
  assert.ok(navigationRetryUrls("https://careers.wix.com/location/tel-aviv/positions/10022791").includes(urls[1]!));
});

test("Wix location hub URL (numeric hub id) does not map to Greenhouse job token", () => {
  assert.deepEqual(directGreenhouseUrlsForCareersUrl("https://careers.wix.com/location/tel-aviv/3789810"), []);
});

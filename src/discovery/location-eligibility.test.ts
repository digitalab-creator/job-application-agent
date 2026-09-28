import assert from "node:assert/strict";
import test from "node:test";
import { isDiscoveryLocationEligible } from "./location-eligibility.js";

test("Tel Aviv on-site role is eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Data Scientist Tel Aviv Full-time", ""), true);
});

test("US city role is not eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Product Marketing Manager Nashville, TN Full-time", ""), false);
});

test("Iceland role is not eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Backend Engineer Iceland Full-time", ""), false);
});

test("explicit remote from Israel is eligible even with US in company name", () => {
  assert.equal(
    isDiscoveryLocationEligible(
      "Senior Engineer — remote from Israel",
      "You can work remotely from Israel.",
    ),
    true,
  );
});

test("Israel in Comeet URL query is eligible", () => {
  assert.equal(
    isDiscoveryLocationEligible(
      "Software Engineer",
      "",
      "https://www.comeet.com/jobs/foo/bar?location=Israel+-+TLV",
    ),
    true,
  );
});

test("title without location markers stays eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Platform Engineer", "Comeet posting"), true);
});

test("foreign city in the title stays ineligible even if the description mentions Tel Aviv", () => {
  assert.equal(
    isDiscoveryLocationEligible(
      "Data Science Team Lead Warsaw Full-time",
      "We also have an office in Tel Aviv",
    ),
    false,
  );
  assert.equal(
    isDiscoveryLocationEligible("Content Marketing Strategist Mountain View, CA Full-time", ""),
    false,
  );
});

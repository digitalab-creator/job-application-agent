import assert from "node:assert/strict";
import test from "node:test";
import { classifyLocationRules, isDiscoveryLocationEligible } from "./location-eligibility.js";

const NO_EXCLUDED: string[] = [];

test("Tel Aviv on-site role is eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Data Scientist Tel Aviv Full-time", "", "", NO_EXCLUDED), true);
});

test("Petah Tikva on-site role is eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Backend Engineer Petah Tikva", "", "", NO_EXCLUDED), true);
});

test("Herzliya on-site role is eligible (Tel Aviv District)", () => {
  assert.equal(isDiscoveryLocationEligible("DevOps Engineer Herzliya", "", "", NO_EXCLUDED), true);
});

test("Kfar Saba on-site role is eligible (Tel Aviv District)", () => {
  assert.equal(isDiscoveryLocationEligible("Product Manager Kfar Saba", "", "", NO_EXCLUDED), true);
});

test("PepsiCo multi-city posting with Kefar Sava Israel is eligible", () => {
  const snippet = "Kefar Sava, Israel; Dublin 2, Ireland; Warsaw, Poland; Purchase, New York; Chicago, Illinois";
  assert.equal(
    isDiscoveryLocationEligible("Digital Growth & Analytics Marketing Sr. Director", snippet, "https://www.pepsicojobs.com/main/jobs/456938", NO_EXCLUDED),
    true,
  );
});

test("Rehovot on-site role is eligible when not on exclude list", () => {
  assert.equal(isDiscoveryLocationEligible("Data Engineer Rehovot", "On-site in Rehovot.", "", NO_EXCLUDED), true);
});

test("Rehovot, Nes Ziona, and Holon are ineligible when admin-excluded", () => {
  const excluded = ["רחובות", "Rehovot", "נס ציונה", "Nes Ziona", "חולון", "Holon"];
  assert.equal(isDiscoveryLocationEligible("Engineer Rehovot", "Office in Rehovot.", "", excluded), false);
  assert.equal(isDiscoveryLocationEligible("Analyst Nes Ziona", "On-site in Nes Ziona.", "", excluded), false);
  assert.equal(isDiscoveryLocationEligible("Developer Holon", "Hybrid in Holon.", "", excluded), false);
});

test("US Sharon town is not treated as Israeli Sharon", () => {
  assert.equal(isDiscoveryLocationEligible("Sales Manager", "Office in Sharon, CT", "", NO_EXCLUDED), false);
});

test("Israeli Sharon with Israel context is eligible", () => {
  assert.equal(
    isDiscoveryLocationEligible("PPC Lead", "Hybrid role in the Sharon area, Israel", "", NO_EXCLUDED),
    true,
  );
});

test("Haifa on-site without remote is not eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Backend Engineer Haifa Full-time", "", "", NO_EXCLUDED), false);
});

test("US city role is not eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Product Marketing Manager Nashville, TN Full-time", "", "", NO_EXCLUDED), false);
});

test("Iceland role is not eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Backend Engineer Iceland Full-time", "", "", NO_EXCLUDED), false);
});

test("explicit remote from Israel is eligible even with US in company name", () => {
  assert.equal(
    isDiscoveryLocationEligible(
      "Senior Engineer — remote from Israel",
      "You can work remotely from Israel.",
      "",
      NO_EXCLUDED,
    ),
    true,
  );
});

test("generic remote role is eligible when not foreign-only", () => {
  assert.equal(isDiscoveryLocationEligible("Platform Engineer (Remote)", "Fully remote position.", "", NO_EXCLUDED), true);
});

test("Israel in Comeet URL query with TLV is eligible", () => {
  assert.equal(
    isDiscoveryLocationEligible(
      "Software Engineer",
      "",
      "https://www.comeet.com/jobs/foo/bar?location=Israel+-+TLV",
      NO_EXCLUDED,
    ),
    true,
  );
});

test("title without location markers is not eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Platform Engineer", "Comeet posting", "", NO_EXCLUDED), false);
});

test("Israel without city is needs_lookup under rules (not eligible until resolved)", () => {
  assert.equal(classifyLocationRules("Platform Engineer Israel", "Great team", "", NO_EXCLUDED), "needs_lookup");
  assert.equal(isDiscoveryLocationEligible("Platform Engineer Israel", "Great team", "", NO_EXCLUDED), false);
});

test("Ra'anana role is excluded when on admin block list", () => {
  assert.equal(
    isDiscoveryLocationEligible("PPC Manager Raanana", "On-site in Ra'anana.", "", ["Raanana"]),
    false,
  );
  assert.equal(
    isDiscoveryLocationEligible("מנהל/ת שיווק", "משרה ברעננה", "", ["רעננה"]),
    false,
  );
});

test("foreign city in the title stays ineligible even if the description mentions Tel Aviv", () => {
  assert.equal(
    isDiscoveryLocationEligible(
      "Data Science Team Lead Warsaw Full-time",
      "We also have an office in Tel Aviv",
      "",
      NO_EXCLUDED,
    ),
    false,
  );
  assert.equal(
    isDiscoveryLocationEligible("Content Marketing Strategist Mountain View, CA Full-time", "", "", NO_EXCLUDED),
    false,
  );
});

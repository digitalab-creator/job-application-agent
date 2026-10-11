import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLocationDetailed,
  classifyLocationRules,
  isDiscoveryLocationEligible,
  matchesExcludedLocationHead,
} from "./location-eligibility.js";

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

test("company careers slug without city in title needs lookup not instant reject", () => {
  assert.equal(
    classifyLocationRules(
      "Senior Growth Marketing Manager",
      "",
      "https://perion.com/careers/senior-growth-marketing-manager/",
      NO_EXCLUDED,
    ),
    "needs_lookup",
  );
});

test("Rehovot, Nes Ziona, and Holon are ineligible when admin-excluded", () => {
  const excluded = ["רחובות", "Rehovot", "נס ציונה", "Nes Ziona", "חולון", "Holon"];
  assert.equal(isDiscoveryLocationEligible("Engineer Rehovot", "Office in Rehovot.", "", excluded), false);
  assert.equal(isDiscoveryLocationEligible("Analyst Nes Ziona", "On-site in Nes Ziona.", "", excluded), false);
  assert.equal(isDiscoveryLocationEligible("Developer Holon", "Hybrid in Holon.", "", excluded), false);
});

test("Netanya is ineligible when admin-excluded", () => {
  assert.equal(
    isDiscoveryLocationEligible("AI Engineer Netanya", "On-site in Netanya.", "", ["Netanya"]),
    false,
  );
  assert.equal(
    isDiscoveryLocationEligible("מהנדס AI", "משרה בנתניה.", "", ["נתניה"]),
    false,
  );
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

test("generic remote with no Israel evidence needs a lookup, not an instant yes", () => {
  assert.equal(classifyLocationRules("Platform Engineer (Remote)", "Fully remote position.", "", NO_EXCLUDED), "needs_lookup");
  assert.equal(isDiscoveryLocationEligible("Platform Engineer (Remote)", "Fully remote position.", "", NO_EXCLUDED), false);
});

test("remote plus Israel evidence is eligible", () => {
  assert.equal(isDiscoveryLocationEligible("Platform Engineer (Remote)", "Team based in Israel.", "", NO_EXCLUDED), true);
  assert.equal(isDiscoveryLocationEligible("Platform Engineer (Remote)", "", "https://careers.example.co.il/jobs/1", NO_EXCLUDED), true);
});

test("remote US stays ineligible", () => {
  assert.equal(isDiscoveryLocationEligible("Platform Engineer (Remote, US)", "", "", NO_EXCLUDED), false);
});

test("hybrid without a city is never treated as remote", () => {
  const detail = classifyLocationDetailed("Growth Manager", "Hybrid role, Israel", "", NO_EXCLUDED);
  assert.equal(detail.verdict, "needs_lookup");
  assert.equal(detail.evidence, "hybrid_without_city");
  assert.equal(classifyLocationRules("Growth Manager", "Hybrid role", "", NO_EXCLUDED), "ineligible");
});

test("Hebrew city names match (JavaScript \\b never matched Hebrew)", () => {
  assert.equal(isDiscoveryLocationEligible("מנהל/ת שיווק", "משרה בתל אביב, היקף מלא", "", NO_EXCLUDED), true);
  assert.equal(isDiscoveryLocationEligible("מפתח Backend", "המשרה בפתח תקווה", "", NO_EXCLUDED), true);
  assert.equal(isDiscoveryLocationEligible("אנליסט", "במשרד ברמת גן", "", NO_EXCLUDED), true);
  assert.equal(isDiscoveryLocationEligible("מנהל קמפיינים", "תל-אביב", "", NO_EXCLUDED), true);
});

test("Hebrew remote needs Hebrew/Israel context and is eligible on an Israeli page", () => {
  assert.equal(isDiscoveryLocationEligible("מנהל PPC", "אפשרות לעבודה מרחוק", "", NO_EXCLUDED), true);
});

test("Hebrew other-region role is ineligible", () => {
  assert.equal(isDiscoveryLocationEligible("מפתח", "משרה בחיפה", "", NO_EXCLUDED), false);
  assert.equal(classifyLocationRules("מפתח", "משרה בבאר שבע", "", NO_EXCLUDED), "ineligible");
});

test("Hebrew words that merely contain a city are not matched", () => {
  // "יהודי" (Jewish) must not read as Yehud; "אזור" (area) must not read as Azor.
  assert.equal(classifyLocationRules("מנהל", "קהילה יהודית באזור הצפון", "", NO_EXCLUDED), "needs_lookup");
});

test("verdict carries evidence for the sheet Location column", () => {
  assert.equal(classifyLocationDetailed("Data Scientist Tel Aviv", "", "", NO_EXCLUDED).evidence, "metro:Tel Aviv");
  assert.equal(classifyLocationDetailed("Engineer", "Office in Raanana", "", ["Raanana"]).evidence, "blocked_city:Raanana");
});

test("Jerusalem in the job header is other_israel_region with the city name", () => {
  assert.equal(
    classifyLocationDetailed("DevOps Engineer", "ירושלים משרה מלאה", "", NO_EXCLUDED).evidence,
    "other_israel_region:ירושלים",
  );
});

test("Netanya is only blocked through the admin list, not hardcoded geography", () => {
  assert.equal(classifyLocationRules("AI Engineer Netanya", "On-site in Netanya, Israel.", "", NO_EXCLUDED), "needs_lookup");
  assert.equal(classifyLocationRules("AI Engineer Netanya", "On-site in Netanya, Israel.", "", ["Netanya"]), "ineligible");
});

test("a blocked city in a long page footer does not block a Tel Aviv job", () => {
  const footer = `${"Great company. ".repeat(300)} Our offices: Tel Aviv, Netanya, London.`;
  assert.equal(matchesExcludedLocationHead("Growth Manager Tel Aviv", footer, "", ["Netanya"]), false);
  assert.equal(matchesExcludedLocationHead("Growth Manager", "Office in Netanya.", "", ["Netanya"]), true);
});

test("malformed percent-encoding in a URL does not crash classification", () => {
  assert.doesNotThrow(() => classifyLocationRules("Role", "", "https://example.com/jobs/%E0%A4%A", NO_EXCLUDED));
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

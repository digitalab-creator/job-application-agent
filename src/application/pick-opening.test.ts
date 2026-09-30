import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOpenings } from "./openings.js";

test("a Comeet company board keeps specific jobs and drops the board link", () => {
  const jobs = normalizeOpenings([
    { title: "Careers", href: "https://www.comeet.com/jobs/fetcherr/68.006", snippet: "All jobs" },
    { title: "Data Science Team Lead", href: "https://www.comeet.com/jobs/fetcherr/68.006/data-science-team-lead/AA.11", snippet: "Data Science Team Lead Tel Aviv" },
    { title: "Data Science Team Lead", href: "https://www.comeet.com/jobs/fetcherr/68.006/data-science-team-lead/AA.11/", snippet: "duplicate" },
    { title: "None", href: "https://www.comeet.com/jobs/fetcherr/68.006/None/9A.71C", snippet: "" },
  ], "https://www.comeet.com/jobs/fetcherr/68.006");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.title, "Data Science Team Lead");
});

test("Wix sibling position links stay visible from a position URL that renders the list", () => {
  const jobs = normalizeOpenings([
    { title: "Full Stack AI Engineer", href: "https://careers.wix.com/location/tel-aviv/positions/10022791", snippet: "Tel Aviv" },
    { title: "Backend Engineer", href: "https://careers.wix.com/location/tel-aviv/positions/10022800", snippet: "Tel Aviv" },
    { title: "Tel Aviv", href: "https://careers.wix.com/location/tel-aviv", snippet: "All jobs" },
  ], "https://careers.wix.com/location/tel-aviv/positions/10022791");
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0]?.href.includes("10022800"));
});

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

test("company-site Greenhouse links keep each gh_jid as a separate job", () => {
  const jobs = normalizeOpenings([
    { title: "Enterprise Account Manager", href: "https://www.riskified.com/job-description/?gh_jid=8831790002", snippet: "Lisbon" },
    { title: "Enterprise Account Manager", href: "https://www.riskified.com/job-description/?gh_jid=8805197002", snippet: "Tel Aviv" },
    { title: "Enterprise Account Manager", href: "https://www.riskified.com/job-description/?gh_jid=8805197002", snippet: "duplicate" },
    { title: "Open roles", href: "https://www.riskified.com/careers/#positions", snippet: "" },
  ], "https://www.riskified.com/careers/");
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1]?.href, "https://www.riskified.com/job-description/?gh_jid=8805197002");
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

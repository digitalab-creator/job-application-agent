import assert from "node:assert/strict";
import test from "node:test";
import { careersPositionId, normalizeOpenings, openingMatchesPositionId } from "./openings.js";

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

test("Dialog positionId links keep the query that identifies each opening", () => {
  const jobs = normalizeOpenings([
    { title: "Senior Backend Engineer", href: "https://www.dialog.co.il/high-tech/jobs/jobpage?positionId=95000", snippet: "Tel Aviv" },
    { title: "AI Engineer", href: "https://www.dialog.co.il/high-tech/jobs/jobpage?positionId=95001", snippet: "Tel Aviv" },
  ], "https://www.dialog.co.il/high-tech/searchresults/?page=10");
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]?.href, "https://www.dialog.co.il/high-tech/jobs/jobpage?positionId=95000");
  assert.equal(jobs[1]?.href, "https://www.dialog.co.il/high-tech/jobs/jobpage?positionId=95001");
});

test("Comblack and GotFriends detail links are valid openings", () => {
  const comblackJobs = normalizeOpenings([
    { title: "Generative AI Engineer", href: "https://comblack.co.il/careers/position-24387/", snippet: "AI Agents" },
  ], "https://comblack.co.il/area/gush-dan/");
  assert.equal(comblackJobs.length, 1);

  const gotFriendsJobs = normalizeOpenings([
    { title: "LLM Engineer", href: "https://www.gotfriends.co.il/jobslobby/ai/llm-engineer/151469/", snippet: "LLM role" },
  ], "https://www.gotfriends.co.il/jobslobby/ai/");
  assert.equal(gotFriendsJobs.length, 1);
});

test("company-hosted Greenhouse gid links on a careers list are separate openings", () => {
  const jobs = normalizeOpenings([
    { title: "Senior Product Manager", href: "https://www.yotpo.com/careers/gid-7633905/", snippet: "Tel-Aviv, IL Senior Product Manager" },
    { title: "Director of Data", href: "https://www.yotpo.com/careers/gid-8211515/", snippet: "Tel-Aviv, IL Director of Data" },
    { title: "Careers", href: "https://www.yotpo.com/careers/", snippet: "Careers" },
  ], "https://www.yotpo.com/careers/");
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]?.title, "Senior Product Manager");
  assert.equal(jobs[0]?.href, "https://www.yotpo.com/careers/gid-7633905");
});

test("position identifiers work in paths and query strings", () => {
  assert.equal(careersPositionId("https://www.dialog.co.il/high-tech/jobs/jobpage?positionId=95000"), "95000");
  assert.equal(careersPositionId("https://comblack.co.il/careers/position-24387/"), "24387");
  assert.equal(
    openingMatchesPositionId({
      title: "Senior Backend Engineer",
      href: "https://www.dialog.co.il/high-tech/jobs/jobpage?positionId=95000",
      snippet: "",
    }, "95000"),
    true,
  );
});

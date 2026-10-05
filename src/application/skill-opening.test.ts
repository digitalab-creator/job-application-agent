import assert from "node:assert/strict";
import test from "node:test";
import { shortlistSkillOpenings } from "./skill-opening.js";

test("skill overlap only creates a shortlist and never authorizes an application", () => {
  const shortlisted = shortlistSkillOpenings([
    { title: "Office Manager", href: "https://jobs.example/jobs/1", snippet: "front desk" },
    { title: "Backend Engineer", href: "https://jobs.example/jobs/2", snippet: "APIs and services" },
    { title: "Intern Designer", href: "https://jobs.example/jobs/3", snippet: "student intern" },
  ]);
  assert.deepEqual(shortlisted.map((job) => job.title), ["Backend Engineer"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { bestSkillOpening } from "./skill-opening.js";

test("board fallback prefers a skill-aligned opening over an unrelated title", () => {
  const chosen = bestSkillOpening([
    { title: "Office Manager", href: "https://jobs.example/jobs/1", snippet: "front desk" },
    { title: "Backend Engineer", href: "https://jobs.example/jobs/2", snippet: "APIs and services" },
    { title: "Intern Designer", href: "https://jobs.example/jobs/3", snippet: "student intern" },
  ]);
  assert.equal(chosen?.title, "Backend Engineer");
});

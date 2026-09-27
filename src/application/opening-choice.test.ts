import assert from "node:assert/strict";
import test from "node:test";
import { acceptOpeningChoice } from "./opening-choice.js";
import type { ListedJob } from "./openings.js";

const openings: ListedJob[] = [
  { title: "Generative AI Engineer", href: "https://example.com/jobs/ai", snippet: "Build LLM products" },
  { title: "Tax Associate", href: "https://example.com/jobs/tax", snippet: "Audit support" },
];

test("a good match is the only choice that can be opened", () => {
  const choice = acceptOpeningChoice({
    fit: "good",
    index: 0,
    reason: "Same applied-AI work as the target role.",
  }, openings);
  assert.equal(choice?.job.title, "Generative AI Engineer");
});

test("no match does not fall through to the closest opening", () => {
  const choice = acceptOpeningChoice({
    fit: "none",
    index: 0,
    reason: "Closest title is still a different job.",
  }, openings);
  assert.equal(choice, null);
});

test("an unknown fit value is rejected", () => {
  const choice = acceptOpeningChoice({
    fit: "closest",
    index: 1,
    reason: "Least bad option.",
  }, openings);
  assert.equal(choice, null);
});

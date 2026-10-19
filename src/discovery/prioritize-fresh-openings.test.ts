import assert from "node:assert/strict";
import test from "node:test";
import { defaultSearchPolicy } from "../config/search-policy.js";
import { prioritizeFreshOpeningsForScoring } from "./prioritize-fresh-openings.js";

test("prioritizeFreshOpeningsForScoring ranks keyword matches ahead of sales titles", () => {
  const policy = defaultSearchPolicy();
  policy.categoryRows = [
    {
      category: "Applied AI",
      keywords: ["LLM Engineer", "Algorithm Engineer"],
      priority: 1,
      included: true,
      share: 0.5,
    },
  ];
  const openings = [
    { title: "Account Executive - SMB", href: "https://example.com/1", snippet: "" },
    { title: "Algorithm Engineer (RTB)", href: "https://example.com/2", snippet: "Tel Aviv" },
    { title: "Advertising Account Manager", href: "https://example.com/3", snippet: "" },
  ];
  const ordered = prioritizeFreshOpeningsForScoring(openings, policy);
  assert.equal(ordered[0]?.title, "Algorithm Engineer (RTB)");
});

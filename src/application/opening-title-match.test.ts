import assert from "node:assert/strict";
import test from "node:test";
import { bestScoredOpening, isHighConfidenceTitleMatch, scoreOpeningTitle } from "./opening-title-match.js";
import type { ListedJob } from "./openings.js";

test("Growth Engineering Lead does not treat xEngineer as a high-confidence substitute", () => {
  assert.equal(isHighConfidenceTitleMatch("Growth Engineering Lead", "xEngineer - AI Creation"), false);
  assert.equal(
    bestScoredOpening("Growth Engineering Lead", [
      { title: "xEngineer - AI Creation", href: "https://careers.wix.com/location/tel-aviv/3789810", snippet: "" },
      { title: "AI Marketing Builder - Base44", href: "https://careers.wix.com/location/tel-aviv/3789810", snippet: "" },
    ]),
    null,
  );
});

test("Growth Engineering Lead prefers growth engineering titles over marketing builder", () => {
  const openings: ListedJob[] = [
    { title: "AI Marketing Builder - Base44", href: "https://careers.wix.com/location/tel-aviv/3789810", snippet: "" },
    { title: "Growth Engineering Lead", href: "https://careers.wix.com/location/tel-aviv/3789810", snippet: "" },
    { title: "Social Media Manager", href: "https://careers.wix.com/location/tel-aviv/3789810", snippet: "" },
  ];
  const best = bestScoredOpening("Growth Engineering Lead", openings);
  assert.equal(best?.title, "Growth Engineering Lead");
  assert.ok(scoreOpeningTitle("Growth Engineering Lead", "AI Marketing Builder - Base44") < 2);
});

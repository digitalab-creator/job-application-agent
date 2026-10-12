import assert from "node:assert/strict";
import test from "node:test";
import {
  headlineForLeadIdentity,
  leadIdentityForTrackerCategory,
  resolveLeadIdentity,
  summaryFactIdForLeadIdentity,
} from "./lead-identity.js";

test("tracker categories map to the three lead identities", () => {
  assert.equal(leadIdentityForTrackerCategory("Performance Marketing Leadership"), "performance");
  assert.equal(leadIdentityForTrackerCategory("Analytics & CRO"), "performance");
  assert.equal(leadIdentityForTrackerCategory("Revenue Systems"), "revenue_martech");
  assert.equal(leadIdentityForTrackerCategory("Marketing Technology"), "revenue_martech");
  assert.equal(leadIdentityForTrackerCategory("Applied AI"), "applied_ai");
  assert.equal(leadIdentityForTrackerCategory("AI Solutions"), "applied_ai");
});

test("full-JD persona wins if sheet category suggests the wrong CV identity", () => {
  assert.equal(
    resolveLeadIdentity({ trackerCategory: "Revenue Systems", persona: "technical" }),
    "applied_ai",
  );
  assert.equal(resolveLeadIdentity({ persona: "marketing" }), "performance");
  assert.equal(resolveLeadIdentity({ persona: "hybrid" }), "revenue_martech");
});

test("each lead identity has headline and summary fact", () => {
  assert.equal(headlineForLeadIdentity("performance"), "marketing-full");
  assert.equal(headlineForLeadIdentity("revenue_martech"), "revenue-martech-full");
  assert.equal(headlineForLeadIdentity("applied_ai"), "tech-full");
  assert.equal(summaryFactIdForLeadIdentity("revenue_martech"), "summary-revenue-martech");
});

test("hybrid role retains revenue MarTech lead while wrong marketing category does not override technical fit", () => {
  assert.equal(resolveLeadIdentity({ trackerCategory: "Marketing Technology", persona: "hybrid" }), "revenue_martech");
  assert.equal(resolveLeadIdentity({ trackerCategory: "Applied AI", persona: "marketing" }), "performance");
});

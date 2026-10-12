import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryBatchTargets,
  normalizeTrackerCategory,
  suggestedPersonaForTrackerCategory,
  trackerCategoryMigrationTarget,
  trackerMarketingShareFromCategories,
  TRACKER_CATEGORY_TARGET_SHARE,
} from "./tracker-categories.js";

test("tracker category shares sum to 100%", () => {
  const sum = [...TRACKER_CATEGORY_TARGET_SHARE.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("legacy Growth Marketing maps to Performance Marketing Leadership", () => {
  assert.equal(normalizeTrackerCategory("Growth Marketing"), "Performance Marketing Leadership");
});

test("migration target is null for canonical categories", () => {
  assert.equal(trackerCategoryMigrationTarget("Applied AI"), null);
  assert.equal(trackerCategoryMigrationTarget("Growth Marketing"), "Performance Marketing Leadership");
});

test("30-day batch of 20 follows category allocation", () => {
  const targets = categoryBatchTargets(20);
  assert.equal(targets.get("Performance Marketing Leadership"), 7);
  assert.equal(targets.get("Revenue Systems"), 5);
  assert.equal(targets.get("Marketing Technology"), 3);
  assert.equal(targets.get("AI Solutions"), 2);
  assert.equal(targets.get("Applied AI"), 2);
  assert.equal(targets.get("Analytics & CRO"), 1);
  const total = [...targets.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 20);
});

test("implied marketing queue share includes MarTech at 80%", () => {
  assert.equal(trackerMarketingShareFromCategories(), 0.80);
});

test("CV persona hints per tracker category", () => {
  assert.equal(suggestedPersonaForTrackerCategory("Performance Marketing Leadership"), "marketing");
  assert.equal(suggestedPersonaForTrackerCategory("Revenue Systems"), "hybrid");
  assert.equal(suggestedPersonaForTrackerCategory("Marketing Technology"), "hybrid");
  assert.equal(suggestedPersonaForTrackerCategory("AI Solutions"), "technical");
  assert.equal(suggestedPersonaForTrackerCategory("Applied AI"), "technical");
  assert.equal(suggestedPersonaForTrackerCategory("Analytics & CRO"), "marketing");
});

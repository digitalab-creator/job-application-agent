import assert from "node:assert/strict";
import test from "node:test";
import { sheetCategoryFromDiscovery } from "./category-map.js";

test("discovery growth maps to Performance Marketing Leadership", () => {
  assert.equal(sheetCategoryFromDiscovery("Growth"), "Performance Marketing Leadership");
});

test("discovery ai maps to Applied AI", () => {
  assert.equal(sheetCategoryFromDiscovery("AI"), "Applied AI");
});

test("discovery revops maps to Revenue Systems", () => {
  assert.equal(sheetCategoryFromDiscovery("Revenue"), "Revenue Systems");
});

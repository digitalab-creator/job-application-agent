import assert from "node:assert/strict";
import test from "node:test";
import { sheetCategoryFromDiscovery } from "./category-map.js";

test("discovery growth maps to Growth Marketing", () => {
  assert.equal(sheetCategoryFromDiscovery("Growth"), "Growth Marketing");
});

test("discovery ai maps to Applied AI", () => {
  assert.equal(sheetCategoryFromDiscovery("AI"), "Applied AI");
});

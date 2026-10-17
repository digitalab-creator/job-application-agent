import assert from "node:assert/strict";
import test from "node:test";
import { defaultSearchPolicy, parseSearchConfigSheet, SEARCH_POLICY_DEFAULT_VERSION } from "./search-policy.js";

test("default search policy uses discovery min score 70", () => {
  const policy = defaultSearchPolicy();
  assert.equal(policy.discoveryMinMatchScore, 70);
  assert.equal(policy.version, SEARCH_POLICY_DEFAULT_VERSION);
});

test("parse Search Config settings and category weights", () => {
  const policy = parseSearchConfigSheet([
    ["Key", "Value", "Category", "Share"],
    ["policy_version", "test-v2", "", ""],
    ["discovery_min_match_score", "70", "", ""],
    ["discover_enabled", "true", "", ""],
    ["skip_discover_when_unresolved_gte", "150", "", ""],
    ["", "", "Performance Marketing Leadership", "35"],
    ["", "", "Revenue Systems", "25"],
    ["", "", "Marketing Technology", "15"],
    ["", "", "AI Solutions", "10"],
    ["", "", "Applied AI", "10"],
    ["", "", "Analytics & CRO", "5"],
  ]);
  assert.equal(policy.version, "test-v2");
  assert.equal(policy.discoveryMinMatchScore, 70);
  assert.equal(policy.skipDiscoverWhenUnresolvedGte, 150);
  assert.equal(policy.categoryWeights.get("Performance Marketing Leadership"), 0.35);
  assert.equal(policy.configSource, "sheet_category_table");
});

test("parse live Search Config column headers (Search Category / Preference / Value)", () => {
  const policy = parseSearchConfigSheet([
    ["Search Category", "Titles / Keywords", "Preference", "Value"],
    ["discovery_min_match_score", "", "", "72"],
    ["discover_enabled", "", "", "true"],
    ["Performance Marketing Leadership", "ppc", "", "35"],
    ["Applied AI", "ai engineer", "", "15"],
  ]);
  assert.equal(policy.discoveryMinMatchScore, 72);
  assert.equal(policy.discoverEnabled, true);
  assert.ok(policy.categoryWeights.get("Performance Marketing Leadership") ?? 0 > 0);
  assert.ok(policy.parseWarnings.length >= 0);
  const perf = policy.categoryRows.find((row) => row.category === "Performance Marketing Leadership");
  assert.equal(perf?.keywords.join(","), "ppc");
});

test("Search Config Include=false removes category weight", () => {
  const policy = parseSearchConfigSheet([
    ["Search Category", "Titles / Keywords", "Priority", "Include", "Value"],
    ["Performance Marketing Leadership", "ppc", "35", "true", "35"],
    ["Applied AI", "ai", "15", "false", "15"],
  ]);
  assert.ok(policy.categoryWeights.get("Performance Marketing Leadership"));
  assert.equal(policy.categoryWeights.has("Applied AI"), false);
  const skipped = policy.categoryRows.find((row) => row.category === "Applied AI");
  assert.equal(skipped?.included, false);
});

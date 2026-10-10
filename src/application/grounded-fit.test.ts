import assert from "node:assert/strict";
import test from "node:test";
import { buildVerbatim } from "../cv/verbatim.js";
import { citeSupportedEvidence, validateCvCoversEvidence, validateRequirementEvidence } from "./grounded-fit.js";

test("validateRequirementEvidence rejects invented fact ids", () => {
  const result = validateRequirementEvidence(
    [{ requirement: "Python", factIds: ["fake-fact"], status: "supported" }],
    new Set(["real-fact"]),
  );
  assert.equal(result.supportedRows.length, 0);
  assert.deepEqual(result.invalidFactIds, ["fake-fact"]);
});

test("citeSupportedEvidence adds a profile fact and a missing role fact verbatim", () => {
  const doc = buildVerbatim("marketing");
  const independent = doc.experience.find((role) => role.roleId === "independent");
  assert.ok(independent);
  independent.bullets = [];
  citeSupportedEvidence(doc, "marketing", [
    { requirement: "High-level written English", factIds: ["lang-english-fluent"], status: "supported" },
    { requirement: "PPC leadership", factIds: ["independent-acquisition"], status: "supported" },
  ]);
  assert.ok(doc.summaryFactIds.includes("lang-english-fluent"));
  assert.equal(independent.bullets.length, 1);
  assert.deepEqual(independent.bullets[0]?.factIds, ["independent-acquisition"]);
  const coverage = validateCvCoversEvidence(doc, "marketing", [
    { requirement: "High-level written English", factIds: ["lang-english-fluent"], status: "supported" },
    { requirement: "PPC leadership", factIds: ["independent-acquisition"], status: "supported" },
  ]);
  assert.equal(coverage.ok, true);
});

test("validateCvCoversEvidence requires supported facts on the CV", () => {
  const doc = buildVerbatim("technical");
  const ok = validateCvCoversEvidence(doc, "technical", [
    { requirement: "production AI", factIds: ["caseedge-production"], status: "supported" },
  ]);
  assert.equal(ok.ok, true);
  const bad = validateCvCoversEvidence(doc, "technical", [
    { requirement: "Java", factIds: ["java-fact"], status: "supported" },
  ]);
  assert.equal(bad.ok, false);
});

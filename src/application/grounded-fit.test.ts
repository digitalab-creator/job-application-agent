import assert from "node:assert/strict";
import test from "node:test";
import { buildVerbatim } from "../cv/verbatim.js";
import { validateCvCoversEvidence, validateRequirementEvidence } from "./grounded-fit.js";

test("validateRequirementEvidence rejects invented fact ids", () => {
  const result = validateRequirementEvidence(
    [{ requirement: "Python", factIds: ["fake-fact"], status: "supported" }],
    new Set(["real-fact"]),
  );
  assert.equal(result.supportedRows.length, 0);
  assert.deepEqual(result.invalidFactIds, ["fake-fact"]);
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

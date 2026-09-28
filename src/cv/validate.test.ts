import assert from "node:assert/strict";
import test from "node:test";
import { buildVerbatim } from "./verbatim.js";
import { validateCv } from "./validate.js";

test("verbatim technical CV passes the truth gates", () => {
  const doc = buildVerbatim("technical");
  const result = validateCv(doc, "technical");
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("verbatim marketing CV passes the truth gates", () => {
  const doc = buildVerbatim("marketing");
  const result = validateCv(doc, "marketing");
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("a bullet that adds Kubernetes and a new metric is rejected", () => {
  const doc = buildVerbatim("technical");
  const role = doc.experience.find((item) => item.roleId === "boroda");
  assert.ok(role);
  role.bullets[0] = {
    factIds: ["boroda-platform"],
    text: "Architected ROI Me on Kubernetes and improved accuracy by 40%.",
  };
  const result = validateCv(doc, "technical");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("Kubernetes")));
  assert.ok(result.errors.some((error) => error.includes("40")));
});

test("verbatim hybrid CV passes the truth gates", () => {
  const doc = buildVerbatim("hybrid");
  const result = validateCv(doc, "hybrid");
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("entity-matching text under Boroda is rejected", () => {
  const doc = buildVerbatim("technical");
  const boroda = doc.experience.find((item) => item.roleId === "boroda");
  assert.ok(boroda);
  boroda.bullets[0] = {
    factIds: ["boroda-platform"],
    text: "Improved entity-matching accuracy from approximately 70% to 95%.",
  };
  const result = validateCv(doc, "technical");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("caseedge") || error.includes("entity-matching")));
});

test("a bullet with no fact id is rejected", () => {
  const doc = buildVerbatim("technical");
  const role = doc.experience[0];
  assert.ok(role);
  role.bullets[0] = { factIds: [], text: "Built a platform." };
  const result = validateCv(doc, "technical");
  assert.equal(result.ok, false);
});

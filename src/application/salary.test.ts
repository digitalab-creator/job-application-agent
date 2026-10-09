import assert from "node:assert/strict";
import test from "node:test";
import { chooseSalary, classifyPublishedSalary } from "./salary.js";

test("chooseSalary quotes by role persona, not generic senior bump", () => {
  assert.equal(chooseSalary("Senior PPC Manager", "marketing"), 23000);
  assert.equal(chooseSalary("PPC Team Lead", "marketing"), 25000);
  assert.equal(chooseSalary("Revenue Systems Engineer", "hybrid"), 25000);
  assert.equal(chooseSalary("Applied AI Engineer", "technical"), 29000);
  assert.equal(chooseSalary("Performance Marketing Manager", "marketing"), 25000);
});

test("classifyPublishedSalary tiers: exclude, manual review, ok, unknown", () => {
  assert.equal(classifyPublishedSalary("great benefits").kind, "ok");
  assert.equal(classifyPublishedSalary("₪15,000 - ₪17,000 gross").kind, "exclude");
  assert.equal(classifyPublishedSalary("₪18,500 - ₪19,500").kind, "manual_review");
  assert.equal(classifyPublishedSalary("₪20,000 - ₪24,000").kind, "ok");
  assert.equal(classifyPublishedSalary("₪35,000 - ₪40,000").kind, "ok");
});

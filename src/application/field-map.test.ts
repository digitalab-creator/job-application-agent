import assert from "node:assert/strict";
import test from "node:test";
import { decideField } from "./field-map.js";

const ctx = {
  persona: "technical" as const,
  salaryMonthly: 32000,
  portfolioUrl: "https://digitalab.co.il/portfolio/?capability=build",
  euRole: false,
};

test("previous salary uses the verified monthly figure", () => {
  const decision = decideField({
    label: "What was your previous salary?",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "ILS 25,000 gross/month");
    assert.equal(decision.source, "candidate_profile");
  }
});

test("a required degree question is blocked", () => {
  const decision = decideField({
    label: "What university degree do you hold?",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "block");
});

test("location-based questions use verified city and country", () => {
  const decision = decideField({
    label: "Where are you currently based?",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "Petah Tikva, Israel");
    assert.equal(decision.source, "candidate_profile");
  }
});

test("expected salary for this senior role stays at the top of the band", () => {
  const decision = decideField({
    label: "Expected salary",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "ILS 32,000 gross/month");
  }
});

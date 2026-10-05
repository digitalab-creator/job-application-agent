import assert from "node:assert/strict";
import test from "node:test";
import { applicationStateFromEvidence } from "./application-state.js";

test("generic browser state is evidence-driven", () => {
  assert.equal(applicationStateFromEvidence({ careersPage: true }), "career_listing");
  assert.equal(applicationStateFromEvidence({ applicationEntry: true }), "application_entry");
  assert.equal(applicationStateFromEvidence({ formDetected: true }), "application_form");
  assert.equal(applicationStateFromEvidence({ nextStep: true }), "application_step");
  assert.equal(applicationStateFromEvidence({ submitted: true }), "submitted");
  assert.equal(applicationStateFromEvidence({ confirmed: true }), "confirmation");
  assert.equal(applicationStateFromEvidence({ manualGate: true }), "manual_gate");
});

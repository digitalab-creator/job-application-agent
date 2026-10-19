import assert from "node:assert/strict";
import test from "node:test";
import { specialistDiscoveryReason } from "./specialist-role.js";

test("narrow unsupported specialty is excluded during discovery", () => {
  assert.equal(specialistDiscoveryReason("Senior Computer Vision Engineer"), "computer_vision_specialist");
  assert.equal(specialistDiscoveryReason("Machine Learning Scientist"), "research_scientist");
  assert.equal(specialistDiscoveryReason("Compiler Engineer"), "specialist_systems_engineer");
});

test("general AI engineering, product and image processing integrations remain eligible", () => {
  for (const role of [
    "Applied AI Engineer",
    "AI Product Builder",
    "Senior Backend Engineer GenAI",
    "Full Stack Engineer",
    "AI Solutions Engineer",
    "Computer Vision Integration Product Manager",
    "Marketing Technology Lead",
  ]) {
    assert.equal(specialistDiscoveryReason(role), null, role);
  }
});

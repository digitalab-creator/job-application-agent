import assert from "node:assert/strict";
import test from "node:test";
import { shouldSkipLlmFallback } from "./screening-fallback-guards.js";

test("degree and demographic blocks skip LLM fallback", () => {
  assert.equal(shouldSkipLlmFallback('Required application question cannot be answered safely: "What university degree"', "degree"), true);
  assert.equal(shouldSkipLlmFallback("block", "What is your gender?"), true);
  assert.equal(shouldSkipLlmFallback("No budget option fits", "Monthly budget"), false);
});

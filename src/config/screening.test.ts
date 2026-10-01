import assert from "node:assert/strict";
import test from "node:test";
import { isShortMotivationField } from "./screening.js";

test("short motivation vs narrative cover letter", () => {
  assert.equal(isShortMotivationField("human-reason", "human-reason"), true);
  assert.equal(isShortMotivationField("Tell us about yourself:", "x"), false);
  assert.equal(isShortMotivationField("Cover letter", "x"), false);
  assert.equal(isShortMotivationField("Why do you want to work here?", "x"), true);
});

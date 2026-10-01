import assert from "node:assert/strict";
import test from "node:test";
import { officeCommuteAnswerYes } from "./office-commute.js";

test("Tel Aviv multi-day commute is accepted", () => {
  const q =
    "Are you comfortable commuting to our Tel Aviv office location three days a week?";
  assert.equal(officeCommuteAnswerYes(q), true);
});

test("Herzliya office commute is accepted", () => {
  assert.equal(officeCommuteAnswerYes("Comfortable commuting to our Herzliya office twice a week?"), true);
});

test("Haifa office commute is declined", () => {
  assert.equal(
    officeCommuteAnswerYes("Are you comfortable commuting to our Haifa office three days a week?"),
    false,
  );
});

test("generic in-office days without a city defaults to yes", () => {
  assert.equal(officeCommuteAnswerYes("This role requires 3 days per week in the office. Are you comfortable?"), true);
});

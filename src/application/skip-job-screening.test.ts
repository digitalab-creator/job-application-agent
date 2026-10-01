import assert from "node:assert/strict";
import test from "node:test";
import {
  declineReasonFromFieldLabels,
  matchesOfficeCommuteSkip,
} from "./skip-job-screening.js";

test("Similarweb Tel Aviv commute question is not skipped", () => {
  const question =
    "Are you comfortable commuting to our Tel Aviv office location three days a week?";
  assert.equal(matchesOfficeCommuteSkip(question), false);
  assert.equal(declineReasonFromFieldLabels([question]), null);
});

test("Haifa commute question is skipped", () => {
  const question = "Are you comfortable commuting to our Haifa office three days a week?";
  assert.equal(matchesOfficeCommuteSkip(question), true);
  assert.ok(declineReasonFromFieldLabels([question]));
});

test("generic Tel Aviv hybrid title is not a commute skip", () => {
  assert.equal(matchesOfficeCommuteSkip("Backend Engineer — Tel Aviv, hybrid friendly"), false);
});

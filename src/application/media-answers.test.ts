import assert from "node:assert/strict";
import test from "node:test";
import { candidate } from "../config/candidate.js";
import { matchPlatforms, pickBudgetOption, pickYearsOption } from "./media-answers.js";

const HUNT_YEARS = ["Please select", "Less than 2 years", "2-5 years", "5+ years"];
const HUNT_BUDGET = ["Please select", "₪100,000 - ₪300,000", "₪300,000 - ₪600,000", "₪600,000+"];
const HUNT_PLATFORMS = ["Google", "Meta", "TikTok", "Taboola", "Outbrain", "Bing", "Yandex", "LinkedIn", "Other"];

test("12 years of PPC lands in the 5+ bucket", () => {
  assert.equal(pickYearsOption(HUNT_YEARS, candidate.media.ppcYears), "5+ years");
});

test("1.5 million ILS per month lands in the open top budget bucket", () => {
  assert.equal(pickBudgetOption(HUNT_BUDGET, candidate.media.maxMonthlyBudgetIls), "₪600,000+");
});

test("known platforms are checked and the rest go to Other", () => {
  const plan = matchPlatforms(HUNT_PLATFORMS, candidate.media.platforms);
  assert.deepEqual(plan.check, ["Google", "Meta", "Taboola", "Outbrain", "Bing", "LinkedIn", "Other"]);
  assert.equal(plan.otherText, "X, ChatGPT Ads, Snapchat, Traffic Junky, Mantis");
});

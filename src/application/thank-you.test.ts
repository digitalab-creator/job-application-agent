import assert from "node:assert/strict";
import test from "node:test";
import { thankYouMatch } from "./thank-you.js";

test("Comeet thank-you line counts as submitted", () => {
  const phrase = thankYouMatch("Thank you! Your application has been submitted. We will be in touch.");
  assert.match(phrase ?? "", /application has been submitted/i);
});

test("a job ad that only says thank you for your interest does not count", () => {
  assert.equal(thankYouMatch("Thank you for your interest in our culture and benefits."), null);
});

test("hebrew receipt counts", () => {
  assert.ok(thankYouMatch("תודה, המועמדות שלך התקבלה"));
});

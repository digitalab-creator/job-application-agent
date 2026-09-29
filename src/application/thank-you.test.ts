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

test("Hunt's CV received page counts as submitted", () => {
  const phrase = thankYouMatch("We got your CV\nWe're grateful for your time and interest.\nYour CV will be reviewed to determine your fit to the company.");
  assert.match(phrase ?? "", /we got your cv/i);
});

test("an Elementor success line counts as submitted", () => {
  assert.match(thankYouMatch("Your submission was successful.") ?? "", /your submission was successful/i);
});

test("Hunt's hidden not-enough-experience note is not a confirmation", () => {
  assert.equal(thankYouMatch("Thank you for your interest in joining Hunt. At this time, this position requires a minimum of 2 years of hands-on PPC experience."), null);
});

test("hebrew receipt counts", () => {
  assert.ok(thankYouMatch("תודה, המועמדות שלך התקבלה"));
});

test("generic thanks for applying counts", () => {
  assert.ok(thankYouMatch("Thanks for applying to Software Engineering Team Manager at Orca Security!"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { matchFieldOption, matchFieldOptionIndex } from "./match-field-option.js";

test("No does not match sponsorship yes option via substring", () => {
  const options = ["Yes, I will need visa sponsorship", "No"];
  assert.equal(matchFieldOption(options, "No"), "No");
  assert.equal(matchFieldOptionIndex(options, "No"), 1);
});

test("Yes matches sponsorship need option by prefix", () => {
  const options = ["Yes, I will need visa sponsorship", "No"];
  assert.equal(matchFieldOption(options, "Yes"), "Yes, I will need visa sponsorship");
});

test("Hebrew no prefix", () => {
  const options = ["כן, אני זקוק לחסות", "לא"];
  assert.equal(matchFieldOption(options, "No"), "לא");
});

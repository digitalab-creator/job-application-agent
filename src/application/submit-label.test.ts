import assert from "node:assert/strict";
import test from "node:test";
import { isSubmitControlLabel } from "./submit-label.js";

test("Hunt APPLY and Comeet Submit Application are both submit controls", () => {
  assert.equal(isSubmitControlLabel("APPLY"), true);
  assert.equal(isSubmitControlLabel("Submit Application"), true);
});

test("Hebrew send button is a submit control", () => {
  assert.equal(isSubmitControlLabel("שלח"), true);
});

test("a share or refer button is not a submit control", () => {
  assert.equal(isSubmitControlLabel("Share on facebook"), false);
  assert.equal(isSubmitControlLabel("COPY LINK"), false);
});

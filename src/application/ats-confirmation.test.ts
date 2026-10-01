import assert from "node:assert/strict";
import test from "node:test";
import { thankYouMatch } from "./thank-you.js";

test("Comeet inline success copy is recognized", () => {
  assert.ok(thankYouMatch("Thank you! Your application has been submitted."));
  assert.ok(thankYouMatch("המועמדות שלך התקבלה. נהיה בקשר."));
});

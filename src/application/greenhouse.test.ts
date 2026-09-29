import assert from "node:assert/strict";
import test from "node:test";
import { thankYouMatch } from "./thank-you.js";

test("Greenhouse thank-you for applying counts as submitted", () => {
  assert.match(
    thankYouMatch("Thanks for applying! We have received your application and will review it soon.") ?? "",
    /thanks for applying/i,
  );
});

test("Greenhouse duplicate apply counts as submitted", () => {
  assert.match(thankYouMatch("You have already applied to this job.") ?? "", /already applied/i);
});

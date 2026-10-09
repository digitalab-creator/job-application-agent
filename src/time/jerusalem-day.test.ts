import assert from "node:assert/strict";
import test from "node:test";
import { instantOnJerusalemDay, jerusalemDayString } from "./jerusalem-day.js";

test("UTC evening maps to next Jerusalem day", () => {
  assert.equal(instantOnJerusalemDay("2026-10-09T22:30:00Z", "2026-10-10"), true);
  assert.equal(instantOnJerusalemDay("2026-10-09T22:30:00Z", "2026-10-09"), false);
});

test("jerusalem day string is stable format", () => {
  const day = jerusalemDayString(new Date("2026-10-09T12:00:00Z"));
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
});

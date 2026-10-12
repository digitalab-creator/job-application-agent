import assert from "node:assert/strict";
import test from "node:test";
import { formatRoleDateRange } from "./dates.js";

test("single-year role shows one year", () => {
  assert.equal(formatRoleDateRange("2025", "2025"), "2025");
});

test("current role uses year–present", () => {
  assert.equal(formatRoleDateRange("Sep 2025", "Present"), "2025–present");
});

test("multi-year range uses years only", () => {
  assert.equal(formatRoleDateRange("2022", "2024"), "2022–2024");
});

test("2024 end date remains 2024 despite January 2025 notice expiry", () => {
  assert.equal(formatRoleDateRange("May 2022","Dec 2024"),"2022–2024");
});

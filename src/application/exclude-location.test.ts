import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getExcludedLocations,
  parseExcludedLocationsText,
  setExcludedLocations,
  textMatchesExcludedLocation,
} from "./exclude-location.js";

test("parseExcludedLocationsText splits commas and newlines", () => {
  assert.deepEqual(parseExcludedLocationsText("רעננה, Raanana\nHerzliya"), ["רעננה", "Raanana", "Herzliya"]);
});

test("textMatchesExcludedLocation finds Hebrew and Latin spellings", () => {
  assert.equal(textMatchesExcludedLocation("משרה ברעננה", ["רעננה"]), true);
  assert.equal(textMatchesExcludedLocation("Office in Ra'anana", ["Raanana"]), true);
  assert.equal(textMatchesExcludedLocation("Tel Aviv", ["רעננה"]), false);
});

test("setExcludedLocations writes runtime config file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exclude-loc-"));
  const filePath = path.join(dir, "excluded-locations.json");
  process.env.APPLY_EXCLUDED_LOCATIONS_PATH = filePath;
  try {
    const saved = setExcludedLocations(["Herzliya"], "test");
    assert.deepEqual(saved.locations, ["Herzliya"]);
    assert.deepEqual(getExcludedLocations(), ["Herzliya"]);
    assert.equal(textMatchesExcludedLocation("Herzliya office"), true);
  } finally {
    delete process.env.APPLY_EXCLUDED_LOCATIONS_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

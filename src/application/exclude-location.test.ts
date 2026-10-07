import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getExcludedLocations,
  locationNeedleMatchesText,
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
  assert.equal(textMatchesExcludedLocation("משרה בנתניה", ["נתניה"]), true);
  assert.equal(textMatchesExcludedLocation("Office in Netanya", ["Netanya"]), true);
  assert.equal(textMatchesExcludedLocation("Tel Aviv", ["רעננה"]), false);
});

test("excluded location does not match substring inside unrelated words", () => {
  assert.equal(locationNeedleMatchesText("Raanana", "Extraordinary performance"), false);
  assert.equal(locationNeedleMatchesText("Raanana", "Team based in Raanana"), true);
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

test("a missing block-list file blocks nothing and never falls back to a hidden list", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exclude-loc-missing-"));
  process.env.APPLY_EXCLUDED_LOCATIONS_PATH = path.join(dir, "nope.json");
  process.env.APPLY_EXCLUDED_LOCATIONS = "Haifa";
  try {
    assert.deepEqual(getExcludedLocations(), []);
  } finally {
    delete process.env.APPLY_EXCLUDED_LOCATIONS_PATH;
    delete process.env.APPLY_EXCLUDED_LOCATIONS;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("editing the block-list file is picked up without a restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exclude-loc-reload-"));
  const filePath = path.join(dir, "excluded-locations.json");
  process.env.APPLY_EXCLUDED_LOCATIONS_PATH = filePath;
  try {
    fs.writeFileSync(filePath, JSON.stringify({ locations: ["Holon"] }));
    assert.deepEqual(getExcludedLocations(), ["Holon"]);
    fs.writeFileSync(filePath, JSON.stringify({ locations: ["Holon", "Netanya"] }));
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(filePath, future, future);
    assert.deepEqual(getExcludedLocations(), ["Holon", "Netanya"]);
  } finally {
    delete process.env.APPLY_EXCLUDED_LOCATIONS_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

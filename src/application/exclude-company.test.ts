import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getExcludedCompanies,
  isExcludedApplyCompany,
  isExcludedApplyTarget,
  isExcludedApplyUrl,
  normalizeCompanyKey,
  parseExcludedCompaniesText,
  setExcludedCompanies,
} from "./exclude-company.js";

test("normalize strips spaces and hyphens", () => {
  assert.equal(normalizeCompanyKey("K-Logic"), "klogic");
  assert.equal(normalizeCompanyKey("two solutions"), "twosolutions");
  assert.equal(normalizeCompanyKey("בורודה קפלן"), "בורודהקפלן");
});

test("parseExcludedCompaniesText splits commas and newlines", () => {
  assert.deepEqual(parseExcludedCompaniesText("a, b\nc"), ["a", "b", "c"]);
});

test("excluded companies match flexible spelling against a provided list", () => {
  const list = ["בורודה קפלן", "k-logic", "two-solutions"];
  assert.equal(isExcludedApplyCompany("בורודה קפלן", list), true);
  assert.equal(isExcludedApplyCompany("בורודה  קפלן בע\"מ", list), true);
  assert.equal(isExcludedApplyCompany("k-logic", list), true);
  assert.equal(isExcludedApplyCompany("K Logic", list), true);
  assert.equal(isExcludedApplyCompany("K-Logic Israel", list), true);
  assert.equal(isExcludedApplyCompany("two-solutions", list), true);
  assert.equal(isExcludedApplyCompany("Two Solutions Ltd", list), true);
  assert.equal(isExcludedApplyCompany("Orca Security", list), false);
  assert.equal(isExcludedApplyCompany("", list), false);
});

test("Hunt agency is excluded by company name and careers URL", () => {
  const excluded = ["בורודה קפלן", "k-logic", "two-solutions", "Hunt"];
  assert.equal(isExcludedApplyCompany("Hunt", excluded), true);
  assert.equal(isExcludedApplyCompany("Hunt Agency", excluded), true);
  assert.equal(isExcludedApplyUrl("https://www.comeet.com/jobs/Hunt/B4.007/ppc-manager/AA.11"), true);
  assert.equal(isExcludedApplyTarget("Orca Security", "https://www.comeet.com/jobs/orca/1", excluded), false);
  assert.equal(isExcludedApplyTarget("Hunt", "https://example.com/jobs", excluded), true);
});

test("setExcludedCompanies writes runtime config file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exclude-co-"));
  const filePath = path.join(dir, "excluded-companies.json");
  process.env.APPLY_EXCLUDED_COMPANIES_PATH = filePath;
  try {
    const saved = setExcludedCompanies(["K-Logic", "two-solutions"], "test");
    assert.deepEqual(saved.companies, ["K-Logic", "two-solutions"]);
    assert.deepEqual(getExcludedCompanies(), ["K-Logic", "two-solutions"]);
    assert.equal(isExcludedApplyCompany("k logic"), true);
    assert.equal(isExcludedApplyCompany("Orca"), false);
  } finally {
    delete process.env.APPLY_EXCLUDED_COMPANIES_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { countsTowardDailyLimit, quotaSnapshot, rememberQuotaUse } from "./daily-quota.js";

test("a missing job does not use a daily slot", () => {
  assert.equal(countsTowardDailyLimit("closed"), false);
  assert.equal(countsTowardDailyLimit("quota_reached"), false);
  assert.equal(countsTowardDailyLimit("budget_reached"), false);
  assert.equal(countsTowardDailyLimit("applied"), true);
  assert.equal(countsTowardDailyLimit("review"), true);
  assert.equal(countsTowardDailyLimit("not_relevant"), true);
});

test("quota counts real attempts and ignores closed rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-"));
  const previousQuota = process.env.QUOTA_LEDGER_PATH;
  const previousLedger = process.env.LEDGER_PATH;
  const previousLimit = process.env.DAILY_APPLY_LIMIT;
  process.env.QUOTA_LEDGER_PATH = path.join(dir, "quota.jsonl");
  process.env.LEDGER_PATH = path.join(dir, "missing-ledger.jsonl");
  process.env.DAILY_APPLY_LIMIT = "10";
  try {
    rememberQuotaUse({ url: "https://jobs.example/closed", status: "closed" });
    rememberQuotaUse({ url: "https://jobs.example/applied", status: "applied" });
    const snapshot = quotaSnapshot();
    assert.equal(snapshot.limit, 10);
    assert.equal(snapshot.counted, 1);
    assert.equal(snapshot.remaining, 9);
  } finally {
    if (previousQuota === undefined) {
      delete process.env.QUOTA_LEDGER_PATH;
    } else {
      process.env.QUOTA_LEDGER_PATH = previousQuota;
    }
    if (previousLedger === undefined) {
      delete process.env.LEDGER_PATH;
    } else {
      process.env.LEDGER_PATH = previousLedger;
    }
    if (previousLimit === undefined) {
      delete process.env.DAILY_APPLY_LIMIT;
    } else {
      process.env.DAILY_APPLY_LIMIT = previousLimit;
    }
  }
});

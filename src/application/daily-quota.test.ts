import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { countsTowardDailyLimit, quotaSnapshot, rememberQuotaUse } from "./daily-quota.js";

test("only a confirmed application uses a daily slot", () => {
  assert.equal(countsTowardDailyLimit("applied"), true);
  assert.equal(countsTowardDailyLimit("closed"), false);
  assert.equal(countsTowardDailyLimit("quota_reached"), false);
  assert.equal(countsTowardDailyLimit("budget_reached"), false);
  assert.equal(countsTowardDailyLimit("review"), false);
  assert.equal(countsTowardDailyLimit("failed"), false);
  assert.equal(countsTowardDailyLimit("not_relevant"), false);
  assert.equal(countsTowardDailyLimit("already_submitted"), false);
  assert.equal(countsTowardDailyLimit("location_ineligible"), false);
  assert.equal(countsTowardDailyLimit("manual_required"), false);
});

test("quota counts real attempts and ignores closed rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-"));
  const previousQuota = process.env.QUOTA_LEDGER_PATH;
  const previousLedger = process.env.LEDGER_PATH;
  const previousLimit = process.env.DAILY_APPLY_LIMIT;
  const previousMaxAttempts = process.env.DAILY_APPLY_MAX_ATTEMPTS;
  const previousAttempts = process.env.APPLY_ATTEMPTS_PATH;
  process.env.QUOTA_LEDGER_PATH = path.join(dir, "quota.jsonl");
  process.env.LEDGER_PATH = path.join(dir, "missing-ledger.jsonl");
  process.env.APPLY_ATTEMPTS_PATH = path.join(dir, "attempts.jsonl");
  process.env.DAILY_APPLY_LIMIT = "10";
  process.env.DAILY_APPLY_MAX_ATTEMPTS = "3";
  try {
    rememberQuotaUse({ url: "https://jobs.example/closed", status: "closed" });
    rememberQuotaUse({ url: "https://jobs.example/applied", status: "applied" });
    const snapshot = quotaSnapshot();
    assert.equal(snapshot.confirmed, 1);
    assert.equal(snapshot.maxAttempts, 3);
    assert.equal(snapshot.attempted, 0);
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
    if (previousMaxAttempts === undefined) delete process.env.DAILY_APPLY_MAX_ATTEMPTS;
    else process.env.DAILY_APPLY_MAX_ATTEMPTS = previousMaxAttempts;
    if (previousAttempts === undefined) delete process.env.APPLY_ATTEMPTS_PATH;
    else process.env.APPLY_ATTEMPTS_PATH = previousAttempts;
  }
});

test("attempt safety cap closes work independently of confirmed quota", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attempt-cap-"));
  const previousPath = process.env.APPLY_ATTEMPTS_PATH;
  const previousMaxAttempts = process.env.DAILY_APPLY_MAX_ATTEMPTS;
  process.env.APPLY_ATTEMPTS_PATH = path.join(dir, "attempts.jsonl");
  process.env.DAILY_APPLY_MAX_ATTEMPTS = "2";
  fs.writeFileSync(process.env.APPLY_ATTEMPTS_PATH, [
    JSON.stringify({ attemptId: "a", finishedAt: new Date().toISOString() }),
    JSON.stringify({ attemptId: "b", finishedAt: new Date().toISOString() }),
  ].join("\n") + "\n");
  try {
    const snapshot = quotaSnapshot();
    assert.equal(snapshot.attempted, 2);
    assert.equal(snapshot.attemptsRemaining, 0);
  } finally {
    if (previousPath === undefined) delete process.env.APPLY_ATTEMPTS_PATH;
    else process.env.APPLY_ATTEMPTS_PATH = previousPath;
    if (previousMaxAttempts === undefined) delete process.env.DAILY_APPLY_MAX_ATTEMPTS;
    else process.env.DAILY_APPLY_MAX_ATTEMPTS = previousMaxAttempts;
  }
});

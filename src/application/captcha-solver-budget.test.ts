import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captcha2CaptchaCostIls,
  captchaSpendIlsForJob,
  check2CaptchaBudget,
  record2CaptchaSpend,
} from "./captcha-solver-budget.js";

test("2captcha spend respects per-job cap", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-budget-"));
  const prevCost = process.env.CAPTCHA_2CAPTCHA_COST_ILS;
  const prevJobCap = process.env.CAPTCHA_MAX_ILS_PER_JOB;
  const prevLedger = process.env.COST_LEDGER_PATH;
  process.env.CAPTCHA_2CAPTCHA_COST_ILS = "1";
  process.env.CAPTCHA_MAX_ILS_PER_JOB = "1";
  process.env.COST_LEDGER_PATH = path.join(dir, "costs.jsonl");
  const job = "https://www.comeet.com/jobs/example/role/AA.11";
  try {
    record2CaptchaSpend(job, "test");
    assert.equal(captchaSpendIlsForJob(job), 1);
    const blocked = check2CaptchaBudget(job);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.match(blocked.reason, /per_job_cap/);
    }
  } finally {
    if (prevCost === undefined) delete process.env.CAPTCHA_2CAPTCHA_COST_ILS;
    else process.env.CAPTCHA_2CAPTCHA_COST_ILS = prevCost;
    if (prevJobCap === undefined) delete process.env.CAPTCHA_MAX_ILS_PER_JOB;
    else process.env.CAPTCHA_MAX_ILS_PER_JOB = prevJobCap;
    if (prevLedger === undefined) delete process.env.COST_LEDGER_PATH;
    else process.env.COST_LEDGER_PATH = prevLedger;
  }
});

test("estimated 2captcha cost is positive", () => {
  assert.ok(captcha2CaptchaCostIls() > 0);
});

test("2captcha budget check uses shared monthly and daily pool", () => {
  const job = "https://job-boards.greenhouse.io/example/jobs/1";
  const check = check2CaptchaBudget(job);
  if (!check.ok) {
    assert.match(
      check.reason,
      /monthly_budget_insufficient|daily_budget_insufficient|per_job_cap/,
    );
  } else {
    assert.equal(check.ok, true);
  }
});

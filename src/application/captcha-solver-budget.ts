import { budgetSnapshot } from "../budget/monthly-budget.js";
import { readCostCalls, recordExternalSpend } from "../llm/cost-ledger.js";
import { log } from "../logging/logger.js";

const CAPTCHA_PURPOSE = "captcha_2captcha";

export function captchaMaxIlsPerJob(): number {
  const n = Number(process.env.CAPTCHA_MAX_ILS_PER_JOB ?? "2");
  return Number.isFinite(n) && n > 0 ? n : 2;
}

/** Estimated ILS charged per 2captcha solve (tune with CAPTCHA_2CAPTCHA_COST_ILS). */
export function captcha2CaptchaCostIls(): number {
  const ils = Number(process.env.CAPTCHA_2CAPTCHA_COST_ILS ?? "0.35");
  if (Number.isFinite(ils) && ils > 0) {
    return Math.round(ils * 100) / 100;
  }
  const usd = Number(process.env.CAPTCHA_2CAPTCHA_COST_USD ?? "0.003");
  const rate = budgetSnapshot().usdIlsRate;
  return Math.round(usd * rate * 100) / 100;
}

export function captchaSpendIlsForJob(jobUrl: string): number {
  const month = jerusalemMonth();
  return roundIls(
    readCostCalls()
      .filter((call) =>
        call.month === month
        && call.source === "external"
        && call.purpose === CAPTCHA_PURPOSE
        && (call.jobUrl ?? "") === jobUrl,
      )
      .reduce((sum, call) => sum + (call.ils ?? 0), 0),
  );
}

export type CaptchaBudgetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Paid 2captcha draws from the same monthly + daily pool as LLM (via costs.jsonl external rows).
 * Per-job cap stops infinite retries on one URL only.
 */
export function check2CaptchaBudget(jobUrl: string): CaptchaBudgetCheck {
  const cost = captcha2CaptchaCostIls();
  const budget = budgetSnapshot();
  if (!budget.monthlyOpen || budget.remainingIls < cost) {
    return { ok: false, reason: "monthly_budget_insufficient" };
  }
  if (!budget.dailyOpen || budget.dailyRemainingIls < cost) {
    return { ok: false, reason: "daily_budget_insufficient" };
  }
  const jobSpent = captchaSpendIlsForJob(jobUrl);
  if (jobSpent + cost > captchaMaxIlsPerJob()) {
    return { ok: false, reason: `per_job_cap_${captchaMaxIlsPerJob()}_ils` };
  }
  return { ok: true };
}

export function record2CaptchaSpend(jobUrl: string, note?: string): void {
  const ils = captcha2CaptchaCostIls();
  recordExternalSpend({
    month: jerusalemMonth(),
    source: "external",
    label: CAPTCHA_PURPOSE,
    ils,
    note,
    jobUrl,
  });
  const budget = budgetSnapshot();
  log("CAPTCHA_2CAPTCHA_SPEND_RECORDED", {
    jobUrl,
    ils,
    jobSpentIls: captchaSpendIlsForJob(jobUrl),
    monthlyRemainingIls: budget.remainingIls,
    dailyRemainingIls: budget.dailyRemainingIls,
  });
}

function roundIls(value: number): number {
  return Math.round(value * 100) / 100;
}

function jerusalemDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function jerusalemMonth(date = new Date()): string {
  return jerusalemDay(date).slice(0, 7);
}

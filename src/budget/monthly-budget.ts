import { monthlyFixedCostIls, usdIlsRate } from "./config.js";
import { readCostCalls, recordExternalSpend } from "../llm/cost-ledger.js";

export type BudgetSnapshot = {
  day: string;
  month: string;
  daysRemaining: number;
  limitIls: number;
  fixedCostIls: number;
  llmSpendUsd: number;
  llmSpendIls: number;
  manualSpendIls: number;
  spentIls: number;
  remainingIls: number;
  dailyBudgetIls: number;
  dailySpentIls: number;
  dailyRemainingIls: number;
  monthlyOpen: boolean;
  dailyOpen: boolean;
  open: boolean;
  usdIlsRate: number;
  bySource: Record<string, { usd: number; ils: number }>;
};

export function monthlyBudgetLimitIls(): number {
  const parsed = Number(process.env.MONTHLY_BUDGET_ILS ?? "500");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 500;
  }
  return roundIls(parsed);
}

export function budgetSnapshot(): BudgetSnapshot {
  const day = jerusalemDay();
  const month = jerusalemMonth();
  const limitIls = monthlyBudgetLimitIls();
  const rate = usdIlsRate();
  const calls = readCostCalls().filter((call) => call.month === month);
  const bySource: Record<string, { usd: number; ils: number }> = {};
  let llmSpendUsd = 0;
  const fixedEnabled = monthlyFixedCostIls() > 0;
  let platformIls = 0;
  let manualSpendIls = 0;
  let dailySpentIls = 0;
  for (const call of calls) {
    const source = call.source ?? "apply";
    const row = bySource[source] ?? { usd: 0, ils: 0 };
    if (call.source === "platform") {
      if (!fixedEnabled) {
        continue;
      }
      platformIls = roundIls(platformIls + (call.ils ?? 0));
      row.ils = roundIls(row.ils + (call.ils ?? 0));
      row.usd = roundUsd(row.usd + call.usd);
    } else if (call.source === "external") {
      const ils = call.ils ?? usdToIls(call.usd, rate);
      manualSpendIls = roundIls(manualSpendIls + ils);
      row.usd = roundUsd(row.usd + call.usd);
      row.ils = roundIls(row.ils + ils);
      if (call.day === day) {
        dailySpentIls = roundIls(dailySpentIls + ils);
      }
    } else if (call.usd > 0) {
      llmSpendUsd = roundUsd(llmSpendUsd + call.usd);
      row.usd = roundUsd(row.usd + call.usd);
      const ils = usdToIls(call.usd, rate);
      row.ils = roundIls(row.ils + ils);
      if (call.day === day) {
        dailySpentIls = roundIls(dailySpentIls + ils);
      }
    }
    bySource[source] = row;
  }
  const fixedCostIls = fixedEnabled
    ? (platformIls > 0 ? platformIls : Math.min(monthlyFixedCostIls(), limitIls))
    : 0;
  const llmSpendIls = usdToIls(llmSpendUsd, rate);
  const spentIls = roundIls(fixedCostIls + llmSpendIls + manualSpendIls);
  const remainingIls = roundIls(Math.max(0, limitIls - spentIls));
  // Include today in the divisor. Subtracting today's variable spend below makes the
  // allowance self-correct after every recorded model or external cost.
  const daysRemaining = daysRemainingInMonth();
  const dailyBudgetIls = roundIls(remainingIls / daysRemaining);
  const dailyRemainingIls = roundIls(Math.max(0, dailyBudgetIls - dailySpentIls));
  const monthlyOpen = remainingIls > 0.01;
  const dailyOpen = monthlyOpen && dailyRemainingIls > 0.01;
  return {
    day,
    month,
    daysRemaining,
    limitIls,
    fixedCostIls,
    llmSpendUsd: roundUsd(llmSpendUsd),
    llmSpendIls,
    manualSpendIls,
    spentIls,
    remainingIls,
    dailyBudgetIls,
    dailySpentIls,
    dailyRemainingIls,
    monthlyOpen,
    dailyOpen,
    open: dailyOpen,
    usdIlsRate: rate,
    bySource,
  };
}

export function budgetIsOpen(): boolean {
  return budgetSnapshot().open;
}

export function usdToIls(usd: number, rate = usdIlsRate()): number {
  return roundIls(usd * rate);
}

export function recordPlatformAllocationIfNeeded(): void {
  const month = jerusalemMonth();
  const fixed = Math.min(monthlyFixedCostIls(), monthlyBudgetLimitIls());
  if (fixed <= 0) {
    return;
  }
  const already = readCostCalls().some(
    (call) => call.month === month && call.source === "platform" && call.label === "monthly_infra",
  );
  if (already) {
    return;
  }
  recordExternalSpend({
    month,
    source: "platform",
    label: "monthly_infra",
    ils: fixed,
    usd: 0,
    note: "Reserved VPS, n8n, and worker hosting for the month.",
  });
}

export { recordExternalSpend };

function jerusalemDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(date);
}

function jerusalemMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

function daysRemainingInMonth(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.max(1, totalDays - day + 1);
}

function roundIls(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

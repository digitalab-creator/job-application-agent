import { monthlyFixedCostIls, usdIlsRate } from "./config.js";
import { readCostCalls, recordExternalSpend } from "../llm/cost-ledger.js";

export type BudgetSnapshot = {
  month: string;
  limitIls: number;
  fixedCostIls: number;
  llmSpendUsd: number;
  llmSpendIls: number;
  manualSpendIls: number;
  spentIls: number;
  remainingIls: number;
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
  const month = jerusalemMonth();
  const limitIls = monthlyBudgetLimitIls();
  const rate = usdIlsRate();
  const calls = readCostCalls().filter((call) => call.month === month);
  const bySource: Record<string, { usd: number; ils: number }> = {};
  let llmSpendUsd = 0;
  let platformIls = 0;
  let manualSpendIls = 0;
  for (const call of calls) {
    const source = call.source ?? "apply";
    const row = bySource[source] ?? { usd: 0, ils: 0 };
    if (call.source === "platform") {
      platformIls = roundIls(platformIls + (call.ils ?? 0));
      row.ils = roundIls(row.ils + (call.ils ?? 0));
    } else if (call.source === "external") {
      const ils = call.ils ?? usdToIls(call.usd, rate);
      manualSpendIls = roundIls(manualSpendIls + ils);
      row.ils = roundIls(row.ils + ils);
    } else if (call.usd > 0) {
      llmSpendUsd = roundUsd(llmSpendUsd + call.usd);
      row.usd = roundUsd(row.usd + call.usd);
      row.ils = roundIls(row.ils + usdToIls(call.usd, rate));
    }
    bySource[source] = row;
  }
  const fixedCostIls = platformIls > 0 ? platformIls : Math.min(monthlyFixedCostIls(), limitIls);
  const llmSpendIls = usdToIls(llmSpendUsd, rate);
  const spentIls = roundIls(fixedCostIls + llmSpendIls + manualSpendIls);
  const remainingIls = roundIls(Math.max(0, limitIls - spentIls));
  return {
    month,
    limitIls,
    fixedCostIls,
    llmSpendUsd: roundUsd(llmSpendUsd),
    llmSpendIls,
    manualSpendIls,
    spentIls,
    remainingIls,
    open: remainingIls > 0.01,
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

function roundIls(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

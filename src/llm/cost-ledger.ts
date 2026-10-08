import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { costUsd, type TokenUsage } from "./prices.js";

export type CostSource = "apply" | "discovery" | "platform" | "external";

export type CostCall = {
  at: string;
  day: string;
  month: string;
  model: string;
  purpose: string;
  jobUrl: string;
  source: CostSource;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  usd: number;
  ils?: number;
  label?: string;
  note?: string;
};

type CostScope = {
  jobUrl: string;
  source: CostSource;
  calls: CostCall[];
};

const scopes = new AsyncLocalStorage<CostScope>();

export async function withJobCost<T>(
  jobUrl: string,
  work: () => Promise<T>,
  source: CostSource = "apply",
): Promise<{
  result: T;
  usd: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
}> {
  const scope: CostScope = { jobUrl, source, calls: [] };
  const result = await scopes.run(scope, work);
  return { result, ...summarize(scope.calls) };
}

export function recordModelCost(input: {
  model: string;
  purpose: string;
  usage: TokenUsage;
}): CostCall {
  const scope = scopes.getStore();
  const call: CostCall = {
    at: new Date().toISOString(),
    day: jerusalemDay(),
    month: jerusalemMonth(),
    model: input.model,
    purpose: input.purpose,
    jobUrl: scope?.jobUrl ?? "",
    source: scope?.source ?? "apply",
    promptTokens: input.usage.promptTokens,
    cachedTokens: input.usage.cachedTokens,
    completionTokens: input.usage.completionTokens,
    usd: costUsd(input.model, input.usage),
  };
  scope?.calls.push(call);
  appendCost(call);
  return call;
}

export function recordExternalSpend(input: {
  month: string;
  source: CostSource;
  label: string;
  ils: number;
  usd?: number;
  note?: string;
  jobUrl?: string;
}): CostCall {
  const call: CostCall = {
    at: new Date().toISOString(),
    day: jerusalemDay(),
    month: input.month,
    model: "",
    purpose: input.label,
    jobUrl: input.jobUrl?.trim() ?? "",
    source: input.source,
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    usd: input.usd ?? 0,
    ils: roundIls(input.ils),
    label: input.label,
    note: input.note,
  };
  appendCost(call);
  return call;
}

export function readCostCalls(): CostCall[] {
  const filePath = costLedgerPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as CostCall;
        return [{
          ...parsed,
          month: parsed.month ?? parsed.day.slice(0, 7),
          source: parsed.source ?? "apply",
        }];
      } catch {
        return [];
      }
    });
}

export function jobCostSoFar(): { usd: number; promptTokens: number; completionTokens: number; calls: number } {
  return summarize(scopes.getStore()?.calls ?? []);
}

export function todayCostSummary(): {
  day: string;
  usd: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  byModel: Record<string, { usd: number; calls: number }>;
} {
  const day = jerusalemDay();
  const calls = readCostCalls().filter((call) => call.day === day && call.usd > 0);
  const byModel: Record<string, { usd: number; calls: number }> = {};
  for (const call of calls) {
    const row = byModel[call.model] ?? { usd: 0, calls: 0 };
    row.usd = roundUsd(row.usd + call.usd);
    row.calls += 1;
    byModel[call.model] = row;
  }
  return {
    day,
    usd: roundUsd(calls.reduce((sum, call) => sum + call.usd, 0)),
    promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
    completionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
    calls: calls.length,
    byModel,
  };
}

function summarize(calls: CostCall[]): { usd: number; promptTokens: number; completionTokens: number; calls: number } {
  return {
    usd: roundUsd(calls.reduce((sum, call) => sum + call.usd, 0)),
    promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
    completionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
    calls: calls.length,
  };
}

function appendCost(call: CostCall): void {
  const filePath = costLedgerPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(call)}\n`);
}

function costLedgerPath(): string {
  return process.env.COST_LEDGER_PATH?.trim() || "/app/data/ledger/costs.jsonl";
}

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

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundIls(value: number): number {
  return Math.round(value * 100) / 100;
}

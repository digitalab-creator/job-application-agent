import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { costUsd, type TokenUsage } from "./prices.js";

export type CostCall = {
  at: string;
  day: string;
  model: string;
  purpose: string;
  jobUrl: string;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  usd: number;
};

type CostScope = {
  jobUrl: string;
  calls: CostCall[];
};

const scopes = new AsyncLocalStorage<CostScope>();

export async function withJobCost<T>(jobUrl: string, work: () => Promise<T>): Promise<{
  result: T;
  usd: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
}> {
  const scope: CostScope = { jobUrl, calls: [] };
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
    model: input.model,
    purpose: input.purpose,
    jobUrl: scope?.jobUrl ?? "",
    promptTokens: input.usage.promptTokens,
    cachedTokens: input.usage.cachedTokens,
    completionTokens: input.usage.completionTokens,
    usd: costUsd(input.model, input.usage),
  };
  scope?.calls.push(call);
  appendCost(call);
  return call;
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
  const calls = readCosts().filter((call) => call.day === day);
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

function readCosts(): CostCall[] {
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
        return [JSON.parse(line) as CostCall];
      } catch {
        return [];
      }
    });
}

function costLedgerPath(): string {
  return process.env.COST_LEDGER_PATH?.trim() || "/app/data/ledger/costs.jsonl";
}

function jerusalemDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(date);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

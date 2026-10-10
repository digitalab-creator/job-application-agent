import { activeCandidate, salaryMaximum, salaryMinimum } from "../config/candidate.js";
import type { Persona } from "../models/types.js";

const PERFORMANCE_TITLE =
  /ppc|performance marketing|performance manager|paid acquisition|user acquisition|growth manager|paid ads|campaign|media buying|\bcro\b|\bsem\b/;

export type PublishedSalaryVerdict =
  | { kind: "ok"; detail: "" }
  | { kind: "exclude"; detail: string }
  | { kind: "manual_review"; detail: string };

function isPerformanceMarketingTitle(text: string): boolean {
  return PERFORMANCE_TITLE.test(text);
}

function isPerformanceTeamLead(text: string): boolean {
  if (/team lead|teamlead|team-lead/.test(text) && isPerformanceMarketingTitle(text)) {
    return true;
  }
  return /performance lead|ppc lead|paid media lead|head of performance|head of ppc/.test(text);
}

/** Role-specific quote for a single salary field — not the opportunity filter floor. */
export function chooseSalary(role: string, persona: Persona): number {
  const text = role.toLowerCase();

  if (persona === "technical") {
    return assertSalaryInBand(29000);
  }

  if (
    persona === "hybrid" ||
    /martech|revenue systems|revops|revenue operations|marketing operations|marketing technology|implementation/.test(text)
  ) {
    return assertSalaryInBand(25000);
  }

  if (isPerformanceTeamLead(text)) {
    return assertSalaryInBand(25000);
  }

  if (isPerformanceMarketingTitle(text) && /senior|sr\.|principal|staff/.test(text)) {
    return assertSalaryInBand(23000);
  }

  return assertSalaryInBand(25000);
}

function assertSalaryInBand(amount: number): number {
  const min = salaryMinimum();
  const max = salaryMaximum();
  if (amount < min || amount > max) {
    throw new Error(`Salary ${amount} is outside ${min}-${max}`);
  }
  return amount;
}

function publishedMonthlyMaxes(pageText: string): number[] {
  const matches = [...pageText.matchAll(/(?:₪|ils|nis)\s*([\d,]+)\s*(?:-|–|to)\s*(?:₪|ils|nis)?\s*([\d,]+)/gi)];
  const maxes: number[] = [];
  for (const match of matches) {
    const max = Number(match[2]?.replace(/,/g, ""));
    const min = Number(match[1]?.replace(/,/g, ""));
    if (!Number.isFinite(max) || max <= 0 || min <= 1000) {
      continue;
    }
    const monthlyMax = max > 200000 ? Math.round(max / 12) : max;
    maxes.push(monthlyMax);
  }
  return maxes;
}

/** Published page salary only. Sheet estimates are not reliable enough to reject a job. */
export function classifyPublishedSalary(pageText: string): PublishedSalaryVerdict {
  const maxes = publishedMonthlyMaxes(pageText);
  if (maxes.length === 0) {
    return { kind: "ok", detail: "" };
  }
  const monthlyMax = Math.min(...maxes);
  const excludeBelow = activeCandidate().salaryExpectation.opportunityFilter.excludeBelow;
  const processingMin = activeCandidate().salaryExpectation.opportunityFilter.processingMinimum;
  if (monthlyMax < excludeBelow) {
    return {
      kind: "exclude",
      detail: `Published salary max ${monthlyMax} ILS/month is below ${excludeBelow}.`,
    };
  }
  if (monthlyMax < processingMin) {
    return {
      kind: "manual_review",
      detail: `Published salary max ${monthlyMax} ILS/month is between ${excludeBelow} and ${processingMin - 1} (manual review).`,
    };
  }
  return { kind: "ok", detail: "" };
}

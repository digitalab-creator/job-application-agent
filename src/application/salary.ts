import {
  candidate,
  SALARY_MAX,
  SALARY_MIN,
} from "../config/candidate.js";
import type { Persona } from "../models/types.js";

const FILTER_EXCLUDE_BELOW = candidate.salaryExpectation.opportunityFilter.excludeBelow;
const FILTER_PROCESSING_MIN = candidate.salaryExpectation.opportunityFilter.processingMinimum;

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
  if (amount < SALARY_MIN || amount > SALARY_MAX) {
    throw new Error(`Salary ${amount} is outside ${SALARY_MIN}-${SALARY_MAX}`);
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
  if (monthlyMax < FILTER_EXCLUDE_BELOW) {
    return {
      kind: "exclude",
      detail: `Published salary max ${monthlyMax} ILS/month is below ${FILTER_EXCLUDE_BELOW}.`,
    };
  }
  if (monthlyMax < FILTER_PROCESSING_MIN) {
    return {
      kind: "manual_review",
      detail: `Published salary max ${monthlyMax} ILS/month is between ${FILTER_EXCLUDE_BELOW} and ${FILTER_PROCESSING_MIN - 1} (manual review).`,
    };
  }
  return { kind: "ok", detail: "" };
}

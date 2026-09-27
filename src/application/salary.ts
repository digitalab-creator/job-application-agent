import { SALARY_MAX, SALARY_MIN } from "../config/candidate.js";
import type { Persona } from "../models/types.js";

export function chooseSalary(role: string, persona: Persona): number {
  const text = role.toLowerCase();
  const senior = /senior|lead|principal|staff|architect|head\b|director/.test(text);
  let amount = 25000;
  if (persona === "technical" && senior) {
    amount = 32000;
  } else if (persona === "technical") {
    amount = 28000;
  } else if (persona === "hybrid" && senior) {
    amount = 30000;
  } else if (persona === "marketing" && senior) {
    amount = 28000;
  } else if (persona === "marketing") {
    amount = 25000;
  }
  if (amount < SALARY_MIN || amount > SALARY_MAX) {
    throw new Error(`Salary ${amount} is outside ${SALARY_MIN}-${SALARY_MAX}`);
  }
  return amount;
}

/** Published page salary only. Sheet estimates are not reliable enough to reject a job. */
export function publishedSalaryTooLow(pageText: string): { tooLow: boolean; detail: string } {
  const matches = [...pageText.matchAll(/(?:₪|ils|nis)\s*([\d,]+)\s*(?:-|–|to)\s*(?:₪|ils|nis)?\s*([\d,]+)/gi)];
  for (const match of matches) {
    const max = Number(match[2]?.replace(/,/g, ""));
    const min = Number(match[1]?.replace(/,/g, ""));
    if (!Number.isFinite(max) || max <= 0) {
      continue;
    }
    const monthlyMax = max > 200000 ? Math.round(max / 12) : max;
    if (monthlyMax < SALARY_MIN && min > 1000) {
      return {
        tooLow: true,
        detail: `Published salary max ${monthlyMax} ILS/month is below ${SALARY_MIN}.`,
      };
    }
  }
  return { tooLow: false, detail: "" };
}

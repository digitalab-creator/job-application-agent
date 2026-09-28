import { candidate, SALARY_MAX, SALARY_MIN } from "../config/candidate.js";
import type { Persona } from "../models/types.js";

export type FieldDecision =
  | { action: "fill"; value: string; source: string }
  | { action: "check"; source: string }
  | { action: "blank" }
  | { action: "block"; reason: string }
  | { action: "upload" }
  | { action: "llm" };

export type FieldContext = {
  persona: Persona;
  salaryMonthly: number;
  portfolioUrl: string;
  euRole: boolean;
};

const DEMOGRAPHIC = /gender|race|ethnicity|religion|disability|veteran|sexual orientation|pronoun/i;
const DEGREE = /university degree|what degree|bachelor|b\.?\s?sc|b\.?\s?a\b|master'?s degree|phd|field of study/i;

export function decideField(input: {
  label: string;
  required: boolean;
  type: string;
  options: string[];
  ctx: FieldContext;
}): FieldDecision {
  const label = input.label.trim();
  const options = input.options;
  if (DEMOGRAPHIC.test(label)) {
    const decline = options.find((option) => /prefer not|decline|don'?t wish|do not wish/i.test(option));
    if (decline) {
      return { action: "fill", value: decline, source: "candidate_profile" };
    }
    if (!input.required) {
      return { action: "blank" };
    }
    return { action: "block", reason: `Required demographic question has no decline option: ${label}` };
  }
  if (input.type === "file" || /resume|cv|curriculum/i.test(label)) {
    return { action: "upload" };
  }
  const mapped = mapKnown(label, input.type, input.ctx);
  if (mapped) {
    return mapped;
  }
  if (input.type === "checkbox" && /privacy|terms|consent|agree|acknowledge/i.test(label) && !/marketing|newsletter/i.test(label)) {
    return { action: "check", source: "candidate_profile" };
  }
  if (DEGREE.test(label)) {
    return input.required
      ? { action: "block", reason: `Required application question cannot be answered safely: "${label}"` }
      : { action: "blank" };
  }
  if (/^how did you hear|source$/i.test(label) || /how did you hear/i.test(label)) {
    const choice = options.find((option) => /^other$/i.test(option.trim()))
      ?? options.find((option) => /comeet|job board|career site/i.test(option));
    if (choice) {
      return { action: "fill", value: choice, source: "candidate_profile" };
    }
  }
  if (isFreeText(label, input.type)) {
    return input.required || label.length > 0 ? { action: "llm" } : { action: "blank" };
  }
  if (input.required) {
    return { action: "block", reason: `Required application question cannot be answered safely: "${label}"` };
  }
  return { action: "blank" };
}

function mapKnown(label: string, type: string, ctx: FieldContext): FieldDecision | null {
  if (/first name|שם פרטי/i.test(label)) {
    return fill(candidate.firstName);
  }
  if (/last name|surname|family name|שם משפחה/i.test(label)) {
    return fill(candidate.lastName);
  }
  if (/full name/i.test(label) && !/first|last/i.test(label)) {
    return fill(candidate.fullName);
  }
  if (/e-?mail|אימייל|דוא"ל/i.test(label)) {
    return fill(candidate.email);
  }
  if (/phone|mobile|טלפון|נייד/i.test(label)) {
    const international = /country|\+|international/i.test(label);
    return fill(international ? candidate.phone.international : candidate.phone.local);
  }
  if (/linkedin/i.test(label)) {
    return fill(candidate.linkedin);
  }
  if (/github/i.test(label)) {
    return fill(candidate.github);
  }
  if (/portfolio|personal (site|website)|website|url/i.test(label) && !/linkedin|github/i.test(label)) {
    if (!ctx.portfolioUrl) {
      return { action: "blank" };
    }
    return fill(ctx.portfolioUrl);
  }
  if (/city|town|עיר/i.test(label) && !/capacity/i.test(label)) {
    return fill(candidate.location.city);
  }
  if (/country/i.test(label) && !/authorized|sponsor|eligible/i.test(label)) {
    return fill(candidate.location.country);
  }
  if (/where are you (currently )?based|currently based|where do you live|current location|מיקום|איפה אתה גר/i.test(label)) {
    return fill(`${candidate.location.city}, ${candidate.location.country}`);
  }
  if (/notice period|start date|availability|הודעה מוקדמת/i.test(label)) {
    return fill(candidate.noticePeriod);
  }
  if (/current salary|last salary|previous salary|present salary/i.test(label)) {
    return fill(salaryText(label, candidate.lastSalary.amount, candidate.lastSalary.annualAmount));
  }
  if (/expected salary|salary expectation|desired salary|compensation expectation|שכר/i.test(label)) {
    return fill(salaryText(label, ctx.salaryMonthly, ctx.salaryMonthly * 12));
  }
  if (/sponsor/i.test(label)) {
    return yesNo(false, type);
  }
  if (/authorized|authorised|eligible to work|work authorization|legally (allowed|eligible)|right to work/i.test(label)) {
    if (/united states|\bus\b|u\.s\.|canada|uk\b|united kingdom/i.test(label) && !/israel|eu|europe|eea/i.test(label)) {
      return { action: "block", reason: `Required application question cannot be answered safely: "${label}"` };
    }
    return yesNo(true, type);
  }
  if (/years of (experience|software|professional)|שנות ניסיון/i.test(label)) {
    if (ctx.persona === "marketing") {
      return fill("10+ years");
    }
    return fill("5+ years");
  }
  if (/hebrew/i.test(label) && /language|proficiency|level/i.test(label)) {
    return fill("Native");
  }
  if (/english/i.test(label) && /language|proficiency|level/i.test(label)) {
    return fill("Full professional proficiency");
  }
  return null;
}

function salaryText(label: string, monthly: number, annual: number): string {
  const amount = /per year|annual|שנתי/i.test(label) ? annual : monthly;
  if (amount > SALARY_MAX * 12) {
    throw new Error("Salary answer exceeded the approved annual maximum.");
  }
  if (!/per year|annual|שנתי/i.test(label) && (amount < SALARY_MIN || amount > SALARY_MAX) && amount !== candidate.lastSalary.amount) {
    throw new Error("Monthly salary answer is outside the approved band.");
  }
  if (/per year|annual|שנתי/i.test(label)) {
    return `ILS ${amount.toLocaleString("en-US")} gross/year`;
  }
  return `ILS ${amount.toLocaleString("en-US")} gross/month`;
}

function fill(value: string): FieldDecision {
  return { action: "fill", value, source: "candidate_profile" };
}

function yesNo(yes: boolean, type: string): FieldDecision {
  if (type === "checkbox") {
    return yes ? { action: "check", source: "candidate_profile" } : { action: "blank" };
  }
  return fill(yes ? "Yes" : "No");
}

function isFreeText(label: string, type: string): boolean {
  if (type !== "textarea" && type !== "contenteditable") {
    return false;
  }
  return /why|describe|tell us|cover letter|about|experience with|campaign|built|motivation/i.test(label);
}

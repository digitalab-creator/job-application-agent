import { candidate, SALARY_MAX, SALARY_MIN } from "../config/candidate.js";
import { isShortMotivationField, screeningMotivation } from "../config/screening.js";
import type { Persona } from "../models/types.js";
import { roles } from "../profile/facts.js";
import { isOfficeCommuteQuestion, officeCommuteAnswerYes } from "./office-commute.js";
import { isPlatformQuestion, matchPlatforms, pickBudgetOption, pickYearsOption } from "./media-answers.js";
import { matchesOfficeCommuteSkip } from "./skip-job-screening.js";

export type FieldDecision =
  | { action: "fill"; value: string; source: string }
  | { action: "check"; source: string }
  | { action: "check-options"; values: string[]; source: string }
  | { action: "blank" }
  | { action: "block"; reason: string }
  | { action: "skip_job"; reason: string }
  | { action: "upload" }
  | { action: "llm" };

export type FieldContext = {
  persona: Persona;
  salaryMonthly: number;
  portfolioUrl: string;
  euRole: boolean;
  company?: string;
  role?: string;
  jobUrl?: string;
  /** Short JD / page text for location-aware screening (commute, etc.). */
  jobText?: string;
  otherPlatformsText?: string;
};

const DEMOGRAPHIC = /gender|race|ethnicity|religion|disability|veteran|sexual orientation|pronoun/i;
const DEGREE = /university degree|what degree|bachelor|b\.?\s?sc|b\.?\s?a\b|master'?s degree|phd|field of study/i;

export function decideField(input: {
  label: string;
  name?: string;
  id?: string;
  groupLabel?: string;
  required: boolean;
  type: string;
  options: string[];
  ctx: FieldContext;
}): FieldDecision {
  const hint = resolveFieldHint(input);
  const label = hint;
  const options = input.options;
  const screeningBlob = `${label} ${input.groupLabel ?? ""}`.trim();
  if (matchesOfficeCommuteSkip(screeningBlob)) {
    return {
      action: "skip_job",
      reason: `Screening question declined by policy: "${screeningBlob.slice(0, 120)}"`,
    };
  }
  if (!label && input.required) {
    return { action: "block", reason: `Required application question cannot be answered safely: ""` };
  }
  if (!label) {
    return { action: "blank" };
  }
  if (isOfficeCommuteQuestion(label)) {
    const extra = [input.ctx.role, input.ctx.jobUrl, input.ctx.jobText].filter(Boolean).join(" ");
    return yesNo(officeCommuteAnswerYes(label, extra), input.type);
  }
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
  const bucket = chooseBucket(label, input.options, input.type);
  if (bucket) {
    return bucket;
  }
  if (input.type === "checkbox-group" && isPlatformQuestion(label, input.options)) {
    const plan = matchPlatforms(input.options, candidate.media.platforms);
    if (plan.check.length === 0) {
      return input.required
        ? { action: "block", reason: `Required platform question has no matching option: "${label}"` }
        : { action: "blank" };
    }
    return { action: "check-options", values: plan.check, source: "candidate_profile" };
  }
  const mapped = mapKnown(label, input.type, input.ctx, input.name, input.id, options);
  if (mapped) {
    return mapped;
  }
  if (input.type === "checkbox" && /privacy|terms|consent|agree|acknowledge|read and understood/i.test(label) && !/marketing|newsletter/i.test(label)) {
    return { action: "check", source: "candidate_profile" };
  }
  if (input.type === "checkbox-group" && /privacy|consent|submitting your application|third party|store and process/i.test(label)) {
    const agree = options.filter((option) => /privacy|consent|agree|read and understood|submitting/i.test(option));
    if (agree.length > 0) {
      return { action: "check-options", values: agree, source: "candidate_profile" };
    }
  }
  if (input.type === "checkbox-group" && /have you read or attended|click all that apply/i.test(label)) {
    const none = options.find((option) => /none of the above|not applicable|none\b/i.test(option));
    if (none) {
      return { action: "check-options", values: [none], source: "candidate_profile" };
    }
    if (!input.required) {
      return { action: "blank" };
    }
  }
  if (input.type === "select" && /privacy|terms|consent|agree|store and process my data/i.test(label)) {
    const agree = options.find((option) => /^yes$/i.test(option.trim()))
      ?? options.find((option) => /^i agree/i.test(option.trim()))
      ?? options.find((option) => /agree/i.test(option) && !/do not|disagree/i.test(option));
    if (agree) {
      return { action: "fill", value: agree, source: "candidate_profile" };
    }
  }
  if ((input.type === "text" || input.type === "search") && /store and process my data|privacy policy|terms and conditions/i.test(label)) {
    return fill("Yes");
  }
  if (DEGREE.test(label)) {
    return input.required
      ? { action: "block", reason: `Required application question cannot be answered safely: "${label}"` }
      : { action: "blank" };
  }
  if (/^how did you hear|how did you find|source of application|referral source/i.test(label) || /how did you hear/i.test(label)) {
    const choice = options.find((option) => /linkedin/i.test(option))
      ?? options.find((option) => /company website|career site|careers page/i.test(option))
      ?? options.find((option) => /job board|comeet|greenhouse/i.test(option))
      ?? options.find((option) => /^other$/i.test(option.trim()))
      ?? options.find((option) => /google/i.test(option));
    if (choice) {
      return { action: "fill", value: choice, source: "candidate_profile" };
    }
    if (input.type === "text" || input.type === "textarea") {
      return fill("LinkedIn");
    }
  }
  if (/business relationship with|work for anyone that has a business relationship|customer, partner, service provider, or vendor/i.test(label)) {
    return yesNo(false, input.type);
  }
  if (/axonius/i.test(label) && /how did you hear/i.test(label)) {
    return fill(options[0] ?? "LinkedIn");
  }
  if (/scale of 1-10|on a scale from 1.?10|rate your .* on a scale|how would you rate your/i.test(label)) {
    const score = selfRatingScore(label, input.ctx.persona);
    if (input.type === "select" || input.type === "radio") {
      const choice = options.find((option) => new RegExp(String.raw`\b${score}\b`).test(option.trim()))
        ?? options.find((option) => option.trim() === String(score));
      if (choice) {
        return fill(choice);
      }
    }
    return fill(String(score));
  }
  if (isFreeText(label, input.type)) {
    return input.required || label.length > 0 ? { action: "llm" } : { action: "blank" };
  }
  if (input.required) {
    return { action: "block", reason: `Required application question cannot be answered safely: "${label}"` };
  }
  return { action: "blank" };
}

function resolveFieldHint(input: {
  label: string;
  name?: string;
  id?: string;
  groupLabel?: string;
}): string {
  const primary = input.label.trim();
  if (primary) {
    return primary;
  }
  const group = (input.groupLabel ?? "").trim();
  if (group) {
    return group;
  }
  const name = (input.name ?? "").trim();
  const id = (input.id ?? "").trim();
  const blob = `${name} ${id}`.toLowerCase();
  if (/^name$/i.test(name) || id === "name" || /\[field0\]/i.test(name)) {
    return "full name";
  }
  if (/first.?name|fname|given.?name/i.test(blob)) {
    return "first name";
  }
  if (/last.?name|lname|family.?name|surname/i.test(blob)) {
    return "last name";
  }
  if (/email/i.test(blob)) {
    return "email";
  }
  if (/phone|tel|mobile/i.test(blob) && !/country_phone|phone_code|dial/i.test(blob)) {
    return "phone";
  }
  if (/country_phone_code|phone_country|dial.code|phone_code/i.test(blob)) {
    return "country phone code";
  }
  if (/hubspot__estimated_monthly_orders|estimated_monthly_orders/i.test(blob)) {
    return "estimated monthly orders";
  }
  if (/privacy|consent|agree|self[- ]?identification|eeo|voluntary/i.test(name + id + group)) {
    return "privacy policy consent";
  }
  if (/^question_/i.test(id)) {
    return group || "application question";
  }
  if (/cards\[/.test(name) && /field0/i.test(name)) {
    return "full name";
  }
  return name || id;
}

function mostRecentEmployment(persona: Persona): { company: string; title: string } {
  const current = roles[0];
  if (!current) {
    return { company: "CaseEdge", title: "Applied AI Engineer" };
  }
  const title = current.defaultTitle[persona] ?? current.defaultTitle.hybrid;
  const company = current.company.split("/")[0]?.trim() ?? current.company;
  return { company, title };
}

function mapKnown(
  label: string,
  type: string,
  ctx: FieldContext,
  name = "",
  id = "",
  options: string[] = [],
): FieldDecision | null {
  const blob = `${label} ${name} ${id}`;
  if (/^name$/i.test(label.trim()) || (label === "full name" && !/first|last/i.test(blob))) {
    return fill(candidate.fullName);
  }
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
  if (/phone|mobile|טלפון|נייד/i.test(label) && !/country phone code|phone_code|dial/i.test(blob)) {
    const international = /country|\+|international/i.test(label);
    return fill(international ? candidate.phone.international : candidate.phone.local);
  }
  if (/country phone code|country_phone_code|phone_country_code|dial code/i.test(blob)) {
    if (type === "select" && options.length > 0) {
      const choice = options.find((option) => /\+972|^972|\bisrael\b/i.test(option))
        ?? options.find((option) => /israel/i.test(option));
      if (choice) {
        return { action: "fill", value: choice, source: "candidate_profile" };
      }
    }
    return fill("+972");
  }
  if (/most recent company|current company|latest company/i.test(label)) {
    return fill(mostRecentEmployment(ctx.persona).company);
  }
  if (/most recent title|current title|latest title|current job title/i.test(label)) {
    return fill(mostRecentEmployment(ctx.persona).title);
  }
  if (/estimated monthly orders|hubspot__estimated/i.test(blob)) {
    if (type === "select" && options.length > 0) {
      const choice = options.find((option) => /1.*10|0.*50|under 100|1-50/i.test(option))
        ?? options.find((option) => !/select|choose/i.test(option));
      if (choice) {
        return { action: "fill", value: choice, source: "candidate_profile" };
      }
    }
    return fill("1-10");
  }
  if (/linkedin/i.test(label)) {
    return fill(candidate.linkedin);
  }
  if (/^website$/i.test(label.trim())) {
    const url = ctx.portfolioUrl || candidate.portfolio.build;
    return fill(url);
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
  if (/other/i.test(label) && /specif|which other platform/i.test(label)) {
    const extra = ctx.otherPlatformsText?.trim() ?? "";
    if (!extra) {
      return { action: "blank" };
    }
    return fill(extra);
  }
  if (/years of .*(experience|software|professional)|years of hands-on|שנות ניסיון/i.test(label)) {
    if (/ppc|paid|performance|hands-on|media|user acquisition/i.test(label) || ctx.persona === "marketing") {
      return fill(`${candidate.media.ppcYears} years`);
    }
    return fill("5+ years");
  }
  if (isShortMotivationField(label, blob) && type !== "file") {
    return fill(screeningMotivation(ctx.persona));
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

function chooseBucket(label: string, options: string[], type: string): FieldDecision | null {
  const professionalYears = candidate.media.ppcYears;
  const freeTextYears = /year/i.test(label)
    && /experience|ppc|paid|performance|hands-on|media|user acquisition|ניסיון/i.test(label);
  const freeTextBudget = /budget|spend|תקציב/i.test(label);
  if (options.length === 0 && (type === "text" || type === "number" || type === "textarea")) {
    if (freeTextYears) {
      const years = /ppc|paid|performance|hands-on|media|user acquisition/i.test(label)
        ? candidate.media.ppcYears
        : professionalYears;
      return fill(String(years));
    }
    if (freeTextBudget) {
      return fill(`ILS ${candidate.media.maxMonthlyBudgetIls.toLocaleString("en-US")} per month`);
    }
  }
  if (/primary paid media focus|paid media focus/i.test(label)) {
    if (options.length === 0) {
      return fill(candidate.media.primaryPaidMediaFocus);
    }
    const focus = candidate.media.primaryPaidMediaFocus.toLowerCase();
    const choice = options.find((option) => {
      const text = option.toLowerCase();
      if (/full.?funnel|full stack growth/i.test(focus)) {
        return /full.?funnel|growth|acquisition.*cro|cro.*analytics/i.test(text);
      }
      return text.includes(focus) || focus.includes(text);
    })
      ?? options.find((option) => /growth|performance|acquisition/i.test(option));
    if (!choice) {
      return { action: "block", reason: `No paid-media focus option matches profile: "${label}"` };
    }
    return fill(choice);
  }
  if (options.length === 0 && /budget|spend|תקציב/i.test(label)) {
    return fill(`ILS ${candidate.media.maxMonthlyBudgetIls.toLocaleString("en-US")} per month`);
  }
  if (options.length === 0 && /year/i.test(label) && /experience|hands-on|paid|media|acquisition|ppc/i.test(label)) {
    return fill(String(/ppc|paid|performance|hands-on|media|acquisition/i.test(label) ? candidate.media.ppcYears : professionalYears));
  }
  if (options.length === 0) {
    return null;
  }
  if (/do you have|have you/i.test(label) && options.some((option) => /^yes$/i.test(option.trim()))) {
    const threshold = parseExperienceThreshold(label);
    if (threshold !== null) {
      return professionalYears >= threshold
        ? fill(options.find((option) => /^yes$/i.test(option.trim())) ?? "Yes")
        : fill(options.find((option) => /^no$/i.test(option.trim())) ?? "No");
    }
  }
  if (/year/i.test(label) && /experience|ppc|ניסיון|paid|hands-on|compiler|llm|production|serving|degree|field/i.test(label)) {
    const years = /ppc|paid|performance|hands-on|media/i.test(label) ? candidate.media.ppcYears : professionalYears;
    const choice = pickYearsOption(options, years) ?? topListedOption(options);
    if (!choice) {
      return { action: "block", reason: `No experience option fits ${years} years: "${label}"` };
    }
    return { action: "fill", value: choice, source: "candidate_profile" };
  }
  if (/budget|spend|תקציב/i.test(label)) {
    const choice = pickBudgetOption(options, candidate.media.maxMonthlyBudgetIls) ?? topListedOption(options);
    if (!choice) {
      return { action: "block", reason: `No budget option fits the managed monthly budget: "${label}"` };
    }
    return { action: "fill", value: choice, source: "candidate_profile" };
  }
  return null;
}

/** Self-assessed 1–10 screening (BI/SQL, analytics tools). Grounded in verified profile, not inflated. */
function selfRatingScore(label: string, persona: Persona): number {
  const blob = label.toLowerCase();
  if (/sql|bi\/|analytics tools|looker|tableau|amplitude|data warehouse/i.test(blob)) {
    return persona === "marketing" ? 7 : 8;
  }
  if (/python|typescript|software|engineering/i.test(blob)) {
    return 8;
  }
  return persona === "marketing" ? 7 : 8;
}

function topListedOption(options: string[]): string | null {
  const real = options.filter((option) => !/^(select|choose|please)/i.test(option.trim()));
  let best: { option: string; amount: number } | null = null;
  for (const option of real) {
    const nums = [...option.matchAll(/\d[\d,]*/g)].map((match) => Number(match[0].replace(/,/g, ""))).filter((value) => value >= 1);
    const amount = nums.length > 0 ? Math.max(...nums) : 0;
    if (!best || amount > best.amount) {
      best = { option, amount };
    }
  }
  return best?.option ?? null;
}

function parseExperienceThreshold(label: string): number | null {
  const plus = label.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus?.[1]) {
    return Number(plus[1]);
  }
  const years = label.match(/(\d+(?:\.\d+)?)\s*(?:or more )?years/i);
  if (years?.[1]) {
    return Number(years[1]);
  }
  return null;
}

function isFreeText(label: string, type: string): boolean {
  if (type !== "textarea" && type !== "contenteditable") {
    return false;
  }
  return /why|describe|tell us|cover letter|about|experience with|campaign|built|motivation/i.test(label);
}

export function isNarrativeQuestion(label: string): boolean {
  return /tell us about|about yourself|cover letter|why (do you|are you|this (role|position|company))/i.test(label);
}

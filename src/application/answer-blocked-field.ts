import { z } from "zod";
import { candidate } from "../config/candidate.js";
import { completeJson } from "../llm/client.js";
import { log } from "../logging/logger.js";
import { unsupportedAnswer } from "../cv/validate.js";
import { personaDefaults } from "../cv/persona.js";
import type { Persona } from "../models/types.js";
import { learnedAnswerForQuestion, questionFactId, upsertLearnedFact } from "../profile/learned-facts.js";
import { verifiedFactsForPersona } from "../profile/verified-facts.js";
import { shouldSkipLlmFallback } from "./screening-fallback-guards.js";

const schema = z.object({
  answer: z.string(),
  factIds: z.array(z.string()),
  storeAsFact: z.boolean().optional(),
});

const SYSTEM = `You answer ONE job-application screening question using ONLY the candidate's verified facts and confirmedMedia.
The approvedSkills list is also verified evidence for this persona. You may answer Yes when the question asks about a listed skill.
If the facts do not support a truthful answer, return {"answer":"","factIds":[]}.
When options are provided, answer MUST be exactly one of those option strings (copy verbatim).
For years, monthly budget, and platforms use confirmedMedia and fact media-hands-on only. Never use a 2M budget.
Short answers are fine (e.g. "12", "Yes", "Full-funnel growth").
Return JSON {"answer": string, "factIds": string[], "storeAsFact": boolean}.
Set storeAsFact true ONLY when the answer is a short, reusable fact (dropdown value, number, yes/no) — never for long prose. Default storeAsFact to false.`;

function mayPersistLearnedAnswer(input: {
  answer: string;
  options: string[];
  factIds: string[];
  persona: Persona;
  approvedSkills: readonly string[];
}): boolean {
  const errors = unsupportedAnswer(input.answer, input.factIds, input.persona, input.approvedSkills);
  if (errors.length > 0) {
    return false;
  }
  if (input.options.length > 0) {
    return input.options.some((option) => option.trim() === input.answer.trim());
  }
  const words = input.answer.trim().split(/\s+/).length;
  return words <= 35;
}

export async function answerBlockedField(input: {
  question: string;
  fieldType: string;
  options: string[];
  persona: Persona;
  jobText: string;
  company: string;
  role: string;
  blockReason: string;
}): Promise<{ value: string; factIds: string[]; learnedFactId?: string } | null> {
  if (shouldSkipLlmFallback(input.blockReason, input.question)) {
    return null;
  }
  const question = input.question.trim() || input.blockReason.slice(0, 200);

  const cached = learnedAnswerForQuestion(question, input.persona);
  if (cached) {
    log("LEARNED_FACT_CACHE_HIT", { question, persona: input.persona });
    return { value: cached, factIds: [questionFactId(question, input.persona)] };
  }

  const allowed = verifiedFactsForPersona(input.persona);
  const approvedSkills = personaDefaults[input.persona].skills;
  const payload = {
    question,
    fieldType: input.fieldType,
    options: input.options,
    blockReason: input.blockReason,
    company: input.company,
    role: input.role,
    persona: input.persona,
    jobDescription: input.jobText.slice(0, 4000),
    confirmedMedia: {
      ppcYears: candidate.media.ppcYears,
      maxMonthlyBudgetIls: candidate.media.maxMonthlyBudgetIls,
      platforms: candidate.media.platforms,
      primaryPaidMediaFocus: candidate.media.primaryPaidMediaFocus,
    },
    workAuthorization: candidate.workAuthorization,
    approvedSkills,
    facts: allowed.map((fact) => ({ id: fact.id, text: fact.text })),
  };
  let raw: unknown;
  try {
    raw = await completeJson(SYSTEM, JSON.stringify(payload), undefined, "answer");
  } catch (error) {
    log("LLM_BLOCKED_FIELD_FAILED", { message: error instanceof Error ? error.message : "llm_failed", question });
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    log("LLM_BLOCKED_FIELD_INVALID", { question });
    return null;
  }
  if (!parsed.data.answer.trim()) {
    log("LLM_BLOCKED_FIELD_EMPTY", { question });
    return null;
  }
  let answer = parsed.data.answer.trim();
  if (input.options.length > 0) {
    const exact = input.options.find((option) => option.trim() === answer);
    if (!exact) {
      log("LLM_BLOCKED_FIELD_OPTION_MISMATCH", { question, answer });
      return null;
    }
    answer = exact;
  } else if (answer.length < 1) {
    return null;
  }
  if (/\b2\s*m\b|\b2\s*million\b|2,000,000|2000000/i.test(answer)) {
    log("LLM_BLOCKED_FIELD_REJECTED", { reason: "budget_above_confirmed_media", question });
    return null;
  }
  if (parsed.data.factIds.length === 0) {
    log("LLM_BLOCKED_FIELD_REJECTED", { reason: "no_fact_ids", question });
    return null;
  }
  const errors = unsupportedAnswer(answer, parsed.data.factIds, input.persona, approvedSkills);
  if (errors.length > 0) {
    log("LLM_BLOCKED_FIELD_REJECTED", { reason: errors.join("; "), question });
    return null;
  }
  let learnedFactId: string | undefined;
  const persist = parsed.data.storeAsFact === true
    && mayPersistLearnedAnswer({
      answer,
      options: input.options,
      factIds: parsed.data.factIds,
      persona: input.persona,
      approvedSkills,
    });
  if (persist && question.length > 0) {
    learnedFactId = questionFactId(question, input.persona);
    upsertLearnedFact({
      id: learnedFactId,
      text: answer,
      tags: ["screening", "learned", input.persona],
      personas: [input.persona],
    });
  }
  log("LLM_BLOCKED_FIELD_OK", { question, learnedFactId: learnedFactId ?? "", persisted: Boolean(learnedFactId) });
  return { value: answer, factIds: parsed.data.factIds, learnedFactId };
}

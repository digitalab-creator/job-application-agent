import { z } from "zod";
import { facts } from "../profile/facts.js";
import type { Persona } from "../models/types.js";
import {
  requirementEvidenceRowSchema,
  validateRequirementEvidence,
  type RequirementEvidenceRow,
} from "./grounded-fit.js";

const APPLY_FIT_THRESHOLD = 70;
const MUST_HAVE_COVERAGE_THRESHOLD = 0.65;

/** Office software and personality traits are never a hard skip. Real skills still are. */
const NON_HARD_REQUIREMENT =
  /\b(google sheets|microsoft excel|excel|microsoft office|ms office|attention to detail|teamwork|communication skills|interpersonal|adaptability|fast learner|work ethic|independent|organized execution|self[- ]starter)\b/i;

function isNonHardRequirement(requirement: string): boolean {
  return NON_HARD_REQUIREMENT.test(requirement);
}

const TEAM_DEVELOPMENT_REQUIREMENT =
  /\b(team management|team development|people management|mentoring|coaching)\b/i;
const MENTORING_EVIDENCE = /\b(mentor(?:ed|ing)?|trained|training|recruitment|supervis(?:ed|ing|or)?)\b/i;

function coveredByMentoringFact(requirement: string, factText: string): boolean {
  return TEAM_DEVELOPMENT_REQUIREMENT.test(requirement) && MENTORING_EVIDENCE.test(factText);
}

const requirementsSchema = z.object({
  roleFamily: z.enum(["technical", "marketing", "hybrid", "product", "operations", "other"]),
  seniority: z.enum(["intern", "junior", "mid", "senior", "lead", "manager", "director", "unknown"]),
  mustHaveSkills: z.array(z.string()).max(20),
  preferredSkills: z.array(z.string()).max(20),
  responsibilities: z.array(z.string()).max(12),
  yearsRequired: z.number().min(0).max(50).nullable(),
  location: z.string().max(240),
  workMode: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  languageRequirements: z.array(z.string()).max(8),
  educationRequirements: z.array(z.string()).max(8),
  managementRequirement: z.boolean(),
  domainRequirements: z.array(z.string()).max(12),
  hardBlockers: z.array(z.string()).max(12),
});

export const jobFitAnalysisSchema = z.object({
  requirements: requirementsSchema,
  persona: z.enum(["technical", "marketing", "hybrid"]),
  requirementEvidence: z.array(requirementEvidenceRowSchema).max(40),
  matchedMustHaves: z.array(z.string()).max(20),
  matchedPreferred: z.array(z.string()).max(20),
  matchedFactIds: z.array(z.string()).max(40),
  missingMustHaves: z.array(z.string()).max(20),
  risks: z.array(z.string()).max(20),
  strongestEvidence: z.array(z.string()).max(12),
  reason: z.string().max(800),
});

export type JobFitAnalysis = z.infer<typeof jobFitAnalysisSchema>;

/**
 * Output shape sent to the LLM. Lives next to the zod schema (single source of truth) and
 * `satisfies Record<keyof JobFitAnalysis, unknown>` makes the compiler fail if a top-level key is added/removed
 * in the schema but not here (nested `requirements` keys: keep in sync with requirementsSchema above).
 * Without it the model invents its own keys (decision / candidateFit / rationale) and parsing fails.
 */
export const JOB_FIT_OUTPUT_EXAMPLE = {
  requirements: {
    roleFamily: "technical | marketing | hybrid | product | operations | other",
    seniority: "intern | junior | mid | senior | lead | manager | director | unknown",
    mustHaveSkills: ["skill"],
    preferredSkills: ["skill"],
    responsibilities: ["responsibility"],
    yearsRequired: 0,
    location: "city, country",
    workMode: "remote | hybrid | onsite | unknown",
    languageRequirements: ["language"],
    educationRequirements: ["requirement"],
    managementRequirement: false,
    domainRequirements: ["domain"],
    hardBlockers: ["mandatory requirement the candidate cannot meet"],
  },
  persona: "technical | marketing | hybrid",
  requirementEvidence: [
    { requirement: "must-have skill", factIds: ["verifiedFacts[].id"], status: "supported | missing" },
  ],
  matchedMustHaves: ["must-have skill the candidate has"],
  matchedPreferred: ["preferred skill the candidate has"],
  matchedFactIds: ["verifiedFacts[].id supporting the match"],
  missingMustHaves: ["must-have skill the candidate lacks"],
  risks: ["risk"],
  strongestEvidence: ["short evidence from verified facts"],
  reason: "one short paragraph",
} as const satisfies Record<keyof JobFitAnalysis, unknown>;
export type JobRequirements = z.infer<typeof requirementsSchema>;

export type JobFitResult = {
  fitScore: number;
  decision: "apply" | "skip";
  persona: Persona | null;
  requirements: JobRequirements;
  requirementEvidence: RequirementEvidenceRow[];
  matchedMustHaves: string[];
  missingMustHaves: string[];
  matchedPreferred: string[];
  risks: string[];
  strongestEvidence: string[];
  reason: string;
};

export function evaluateJobFit(
  analysis: JobFitAnalysis,
  verifiedFacts = facts.filter((fact) => fact.verified),
): JobFitResult {
  const factIds = new Set(verifiedFacts.map((fact) => fact.id));
  const evidenceCheck = validateRequirementEvidence(analysis.requirementEvidence, factIds);
  const matchedFactIds = [
    ...new Set(evidenceCheck.supportedRows.flatMap((row) => row.factIds)),
    ...analysis.matchedFactIds.filter((id) => factIds.has(id)),
  ];
  const matchedMustHaves = unique([
    ...evidenceCheck.supportedRows.map((row) => row.requirement),
    ...analysis.matchedMustHaves,
  ]);
  const reportedMissing = unique([
    ...evidenceCheck.missingRequirements,
    ...analysis.missingMustHaves,
  ]);
  const softGaps = reportedMissing.filter(isNonHardRequirement);
  const factText = verifiedFacts.map((fact) => fact.text).join("\n");
  const mentoringGaps = reportedMissing.filter((requirement) => coveredByMentoringFact(requirement, factText));
  const missingMustHaves = reportedMissing.filter(
    (requirement) => !isNonHardRequirement(requirement) && !coveredByMentoringFact(requirement, factText),
  );
  const matchedPreferred = unique(analysis.matchedPreferred);
  const mustHaveCount = Math.max(
    analysis.requirements.mustHaveSkills.length,
    matchedMustHaves.length + missingMustHaves.length,
  );
  const mustHaveCoverage = mustHaveCount === 0
    ? 1
    : matchedMustHaves.length / mustHaveCount;
  const preferredCoverage = analysis.requirements.preferredSkills.length === 0
    ? 1
    : matchedPreferred.length / analysis.requirements.preferredSkills.length;
  const evidenceCoverage = matchedFactIds.length > 0 ? 1 : 0;
  const rolePenalty = analysis.requirements.roleFamily === "other" ? 35 : 0;
  const candidateEvidence = verifiedFacts.map((fact) => fact.text).join(" ");
  const mandatoryEducationMissing = analysis.requirements.educationRequirements
    .filter((requirement) => /required|must|mandatory|minimum/i.test(requirement))
    .filter((requirement) => !evidenceSupportsPhrase(requirement, candidateEvidence))
    .map((requirement) => `Mandatory education requirement is not verified: ${requirement}`);
  const hardBlockers = unique([
    ...analysis.requirements.hardBlockers,
    ...mandatoryEducationMissing,
    ...(evidenceCheck.invalidFactIds.length
      ? [`Unsupported fact ids in requirement evidence: ${evidenceCheck.invalidFactIds.join(", ")}`]
      : []),
  ]);
  const rawFitScore = Math.max(0, Math.min(100, Math.round(
    mustHaveCoverage * 55
      + preferredCoverage * 10
      + evidenceCoverage * 20
      + (analysis.persona ? 15 : 0)
      - rolePenalty
      - hardBlockers.length * 15,
  )));
  const groundedEvidence = evidenceCheck.supportedRows.length > 0;
  const fitScore = groundedEvidence
    ? rawFitScore
    : Math.min(rawFitScore, APPLY_FIT_THRESHOLD - 1);
  const seniorityBlocked = analysis.requirements.seniority === "intern"
    || analysis.requirements.seniority === "junior";
  const decision = !seniorityBlocked
    && hardBlockers.length === 0
    && matchedFactIds.length > 0
    && evidenceCheck.supportedRows.length > 0
    && missingMustHaves.length === 0
    && mustHaveCoverage >= MUST_HAVE_COVERAGE_THRESHOLD
    && fitScore >= APPLY_FIT_THRESHOLD
    ? "apply"
    : "skip";

  return {
    fitScore,
    decision,
    persona: decision === "skip" && analysis.requirements.roleFamily === "other" ? null : analysis.persona,
    requirements: analysis.requirements,
    requirementEvidence: evidenceCheck.supportedRows,
    matchedMustHaves,
    missingMustHaves,
    matchedPreferred,
    risks: unique([
      ...analysis.risks,
      ...mandatoryEducationMissing,
      ...softGaps.map((gap) => `Unverified office or soft trait, not a hard skip: ${gap}`),
      ...mentoringGaps.map((gap) => `Covered by a verified mentoring or training fact: ${gap}`),
    ]),
    strongestEvidence: unique(analysis.strongestEvidence),
    reason: analysis.reason,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function evidenceSupportsPhrase(phrase: string, evidence: string): boolean {
  const required = phrase.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  const available = new Set(evidence.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  return required.length > 0
    && required.filter((token) => available.has(token)).length / required.length >= 0.5;
}

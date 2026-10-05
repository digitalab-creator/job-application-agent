import { z } from "zod";
import { facts } from "../profile/facts.js";
import type { Persona } from "../models/types.js";

const APPLY_FIT_THRESHOLD = 70;
const MUST_HAVE_COVERAGE_THRESHOLD = 0.65;

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
  matchedMustHaves: z.array(z.string()).max(20),
  matchedPreferred: z.array(z.string()).max(20),
  matchedFactIds: z.array(z.string()).max(40),
  missingMustHaves: z.array(z.string()).max(20),
  risks: z.array(z.string()).max(20),
  strongestEvidence: z.array(z.string()).max(12),
  reason: z.string().max(800),
});

export type JobFitAnalysis = z.infer<typeof jobFitAnalysisSchema>;
export type JobRequirements = z.infer<typeof requirementsSchema>;

export type JobFitResult = {
  fitScore: number;
  decision: "apply" | "skip";
  persona: Persona | null;
  requirements: JobRequirements;
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
  const matchedFactIds = analysis.matchedFactIds.filter((id) => factIds.has(id));
  const matchedMustHaves = unique(analysis.matchedMustHaves);
  const missingMustHaves = unique(analysis.missingMustHaves);
  const matchedPreferred = unique(analysis.matchedPreferred);
  const mustHaveCount = matchedMustHaves.length + missingMustHaves.length;
  const mustHaveCoverage = mustHaveCount === 0 ? 1 : matchedMustHaves.length / mustHaveCount;
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
  const hardBlockers = unique([...analysis.requirements.hardBlockers, ...mandatoryEducationMissing]);
  const fitScore = Math.max(0, Math.min(100, Math.round(
    mustHaveCoverage * 55
      + preferredCoverage * 10
      + evidenceCoverage * 20
      + (analysis.persona ? 15 : 0)
      - rolePenalty
      - hardBlockers.length * 15,
  )));
  const seniorityBlocked = analysis.requirements.seniority === "intern"
    || analysis.requirements.seniority === "junior";
  const decision = !seniorityBlocked
    && hardBlockers.length === 0
    && matchedFactIds.length > 0
    && mustHaveCoverage >= MUST_HAVE_COVERAGE_THRESHOLD
    && fitScore >= APPLY_FIT_THRESHOLD
    ? "apply"
    : "skip";

  return {
    fitScore,
    decision,
    persona: decision === "skip" && analysis.requirements.roleFamily === "other" ? null : analysis.persona,
    requirements: analysis.requirements,
    matchedMustHaves,
    missingMustHaves,
    matchedPreferred,
    risks: unique([...analysis.risks, ...mandatoryEducationMissing]),
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

import fs from "node:fs";
import type { CvDocument, Persona } from "../models/types.js";
import { facts, roles } from "../profile/facts.js";
import type { JobRequirements } from "../application/job-fit.js";

export type CvRelevanceResult = {
  relevanceScore: number;
  mustHaveCoverage: number;
  preferredCoverage: number;
  responsibilityCoverage: number;
  keywordCoverage: number;
  strongestMatches: string[];
  importantMissingTerms: string[];
  weakSections: string[];
  decision: "pass" | "regenerate" | "skip";
};

export type CvQualityResult = {
  ok: boolean;
  issues: string[];
};

export function evaluateCvRelevance(
  doc: CvDocument,
  requirements: JobRequirements,
  persona: Persona,
): CvRelevanceResult {
  const evidence = cvEvidence(doc);
  const must = coverage(requirements.mustHaveSkills, evidence);
  const preferred = coverage(requirements.preferredSkills, evidence);
  const responsibilities = coverage(requirements.responsibilities, evidence);
  const allKeywords = [...requirements.mustHaveSkills, ...requirements.preferredSkills, ...requirements.domainRequirements];
  const keywords = coverage(allKeywords, evidence);
  const weakSections = [
    ...(doc.summary.trim().length < 20 ? ["summary"] : []),
    ...(doc.selectedSkills.length < 3 ? ["skills"] : []),
    ...(doc.experience.some((role) => role.bullets.length === 0) ? ["experience"] : []),
  ];
  const relevanceScore = Math.round(
    must.ratio * 45
      + preferred.ratio * 15
      + responsibilities.ratio * 20
      + keywords.ratio * 20
      - weakSections.length * 10,
  );
  const passes = relevanceScore >= 70 && must.ratio >= 0.65 && weakSections.length === 0;
  return {
    relevanceScore: Math.max(0, Math.min(100, relevanceScore)),
    mustHaveCoverage: Math.round(must.ratio * 100),
    preferredCoverage: Math.round(preferred.ratio * 100),
    responsibilityCoverage: Math.round(responsibilities.ratio * 100),
    keywordCoverage: Math.round(keywords.ratio * 100),
    strongestMatches: [...must.matches, ...preferred.matches].slice(0, 12),
    importantMissingTerms: [...must.missing, ...keywords.missing].slice(0, 12),
    weakSections,
    decision: passes ? "pass" : "regenerate",
  };
}

export function validateCvQuality(doc: CvDocument, persona: Persona): CvQualityResult {
  const issues: string[] = [];
  if (doc.summary.trim().length < 20) {
    issues.push("summary_empty_or_too_short");
  }
  if (doc.selectedSkills.length < 3 || doc.selectedSkills.length > 18) {
    issues.push("skills_section_length");
  }
  if (doc.experience.length !== roles.length) {
    issues.push("role_count");
  }
  const roleIds = doc.experience.map((role) => role.roleId);
  if (roleIds.some((roleId, index) => roleId !== roles[index]?.id)) {
    issues.push("role_order");
  }
  const bulletTexts = doc.experience.flatMap((role) => role.bullets.map((bullet) => normalize(bullet.text)));
  if (new Set(bulletTexts).size !== bulletTexts.length) {
    issues.push("duplicate_bullets");
  }
  if (bulletTexts.some((text) => repeatedPhrase(text))) {
    issues.push("repetitive_bullets");
  }
  if (persona === "marketing" && doc.headlineId !== "marketing-full") {
    issues.push("wrong_persona_headline");
  }
  if (persona !== "marketing" && doc.headlineId !== "tech-full") {
    issues.push("wrong_persona_headline");
  }
  return { ok: issues.length === 0, issues };
}

export function validatePdfArtifact(filePath: string): CvQualityResult {
  const issues: string[] = [];
  if (!fs.existsSync(filePath)) {
    return { ok: false, issues: ["pdf_missing"] };
  }
  const data = fs.readFileSync(filePath);
  if (data.length < 1_000 || data.subarray(0, 4).toString() !== "%PDF") {
    issues.push("pdf_unreadable");
  }
  const pages = (data.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
  if (pages < 1 || pages > 2) {
    issues.push("pdf_page_count");
  }
  return { ok: issues.length === 0, issues };
}

function cvEvidence(doc: CvDocument): string {
  const factIds = [
    ...doc.summaryFactIds,
    ...doc.experience.flatMap((role) => role.bullets.flatMap((bullet) => bullet.factIds)),
  ];
  const factsText = factIds.map((id) => facts.find((fact) => fact.id === id)?.text ?? "").join(" ");
  return `${doc.summary} ${doc.selectedSkills.join(" ")} ${factsText}`;
}

function coverage(requirements: string[], evidence: string): { ratio: number; matches: string[]; missing: string[] } {
  const meaningful = requirements.map((value) => value.trim()).filter(Boolean);
  if (meaningful.length === 0) {
    return { ratio: 1, matches: [], missing: [] };
  }
  const matches = meaningful.filter((requirement) => phraseCovered(requirement, evidence));
  return {
    ratio: matches.length / meaningful.length,
    matches,
    missing: meaningful.filter((requirement) => !matches.includes(requirement)),
  };
}

function phraseCovered(phrase: string, evidence: string): boolean {
  const normalizedPhrase = normalize(phrase);
  const normalizedEvidence = normalize(evidence);
  if (jdPhraseAliasCovered(normalizedPhrase, normalizedEvidence)) {
    return true;
  }
  const tokens = tokensOf(phrase);
  if (tokens.length === 0) {
    return false;
  }
  const evidenceTokens = new Set(tokensOf(evidence));
  return tokens.filter((token) => evidenceTokens.has(token)).length / tokens.length >= 0.5;
}

/** Maps long JD phrases to evidence the fact pool already supports (no fabrication). */
function jdPhraseAliasCovered(phrase: string, evidence: string): boolean {
  const rules: Array<{ phrase: RegExp; evidence: RegExp }> = [
    { phrase: /\bai engineering\b/, evidence: /\bai\b.*\b(engineer|engineering|software|agent|llm|ml|gpt)\b/ },
    { phrase: /\bend.to.end feature ownership\b/, evidence: /\b(end.to.end|full stack|owned|ownership|shipped|delivered|built).*\b(feature|product|system|platform)\b/ },
    { phrase: /\bcomplex technical project leadership\b/, evidence: /\b(lead|led|leadership|architect|technical|project|team)\b/ },
    { phrase: /\btechnical project leadership\b/, evidence: /\b(lead|led|leadership|architect|technical|project|team)\b/ },
    { phrase: /\bcross.functional communication\b/, evidence: /\b(cross|stakeholder|product|team|communication|collaborat)\b/ },
    { phrase: /\bproblem solving\b/, evidence: /\b(problem|debug|troubleshoot|root cause|solve|solving)\b/ },
    { phrase: /\bproblem-solving\b/, evidence: /\b(problem|debug|troubleshoot|root cause|solve|solving)\b/ },
    { phrase: /\bai interest and passion\b/, evidence: /\b(ai|agent|llm|gpt|machine learning|passion|excited|enthusiast)\b/ },
    { phrase: /\blarge.scale editor systems\b/, evidence: /\b(large|scale|microservice|platform|production|system|saas)\b/ },
    { phrase: /\bai.enabled website creation\b/, evidence: /\b(ai|website|web|platform|product|saas)\b/ },
  ];
  return rules.some((rule) => rule.phrase.test(phrase) && rule.evidence.test(evidence));
}

function tokensOf(text: string): string[] {
  return normalize(text).split(" ").filter((token) => token.length > 2);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+#./-]+/g, " ").replace(/\s+/g, " ").trim();
}

function repeatedPhrase(text: string): boolean {
  const words = text.split(" ");
  if (words.length < 12) {
    return false;
  }
  const trigrams = new Set<string>();
  for (let index = 0; index <= words.length - 3; index += 1) {
    const trigram = words.slice(index, index + 3).join(" ");
    if (trigrams.has(trigram)) {
      return true;
    }
    trigrams.add(trigram);
  }
  return false;
}

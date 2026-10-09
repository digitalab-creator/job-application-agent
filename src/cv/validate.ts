import { HEADLINES, SKILLS, factById, roleById, roles } from "../profile/facts.js";
import type { CvDocument, Persona } from "../models/types.js";
import type { LeadIdentity } from "./lead-identity.js";
import { headlineForLeadIdentity, resolveLeadIdentity } from "./lead-identity.js";
import { personaDefaults } from "./persona.js";
import { roleSignatureErrors } from "./role-signatures.js";

const GUARDED_TERMS = [
  "Kubernetes",
  "k8s",
  "AWS",
  "GCP",
  "Azure",
  "Java",
  "Golang",
  "Rust",
  "Terraform",
  "Kafka",
  "Spark",
  "TensorFlow",
  "PyTorch",
  "PhD",
  "Bachelor",
  "Master's",
  "MBA",
  "clearance",
  "CaseEdge",
  "Digitalab",
  "Cellcom",
  "LangGraph",
  "LangChain",
  "pgvector",
  "OpenSearch",
  "FastAPI",
  "PostgreSQL",
  "Redis",
  "MariaDB",
  "Docker",
  "Python",
  "TypeScript",
  "React",
  "Node.js",
  "Stanford",
  "Hugging Face",
  "DeepLearning.AI",
  "Google Ads",
  "Meta Ads",
  "TikTok",
  "Microsoft Ads",
  "GA4",
  "GTM",
  "Meta",
  "Walla",
  "Technion",
  "AVIS",
  "Gindi",
  "American Laser",
  "Kibbutzim",
  "Dovdevani",
  "Budget Watch",
  "ROI Me",
  "Full Power",
  "Boroda",
  "K Logic",
  "entity-matching",
];

const SKILL_SET = new Set<string>(SKILLS);

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  factIds: string[];
};

export function validateCv(
  doc: CvDocument,
  persona: Persona,
  leadIdentity?: LeadIdentity,
): ValidationResult {
  const errors: string[] = [];
  const factIds = new Set<string>();
  const identity = leadIdentity ?? resolveLeadIdentity({ persona });
  const expectedHeadline = headlineForLeadIdentity(identity);
  if (doc.headlineId !== expectedHeadline) {
    errors.push(`Lead identity ${identity} requires headline ${expectedHeadline}.`);
  }
  if (!HEADLINES[doc.headlineId]) {
    errors.push("Headline is not in the approved list.");
  }

  if (doc.includePortfolio && !doc.portfolioKey) {
    errors.push("portfolioKey is required when includePortfolio is true.");
  }
  if (!doc.includePortfolio && doc.portfolioKey) {
    errors.push("portfolioKey must be omitted when includePortfolio is false.");
  }

  checkProse(doc.summary, doc.summaryFactIds, persona, "summary", "summary", errors, factIds);
  if (!isExactFact(doc.summary, doc.summaryFactIds) && wordCount(doc.summary) > 120) {
    errors.push("Summary is longer than 120 words.");
  }

  if (doc.experience.length < roles.length) {
    errors.push(`CV must include all ${roles.length} roles from the master list.`);
  }
  const seenRoles = new Set(doc.experience.map((item) => item.roleId));
  for (const master of roles) {
    if (!seenRoles.has(master.id)) {
      errors.push(`CV is missing required role: ${master.company}.`);
    }
  }

  for (const skill of doc.selectedSkills) {
    if (!SKILL_SET.has(skill)) {
      errors.push(`Skill is not in the closed list: ${skill}`);
    }
  }

  for (const role of doc.experience) {
    const record = roleById(role.roleId);
    if (!record) {
      errors.push(`Unknown role: ${role.roleId}`);
      continue;
    }
    if (!record.titleVariants.includes(role.title)) {
      errors.push(`Title is not an approved variant for ${record.company}: ${role.title}`);
    }
    if (role.bullets.length < 1 || role.bullets.length > 5) {
      errors.push(`${record.company} must have 1 to 5 bullets.`);
    }
    role.bullets.forEach((bullet, index) => {
      const label = `${record.company} bullet ${index + 1}`;
      checkProse(bullet.text, bullet.factIds, persona, role.roleId, label, errors, factIds);
      errors.push(...roleSignatureErrors(role.roleId, bullet.text, label));
      checkCitationAnchor(bullet.text, bullet.factIds, label, errors);
      if (!isExactFact(bullet.text, bullet.factIds) && wordCount(bullet.text) > 60) {
        errors.push(`${record.company} bullet ${index + 1} is longer than 60 words.`);
      }
    });
  }

  for (const id of doc.educationFactIds) {
    const fact = factById(id);
    if (!fact || !fact.tags.includes("education")) {
      errors.push(`Education fact is missing: ${id}`);
      continue;
    }
    if (!factAllowed(fact.personas, persona)) {
      errors.push(`Education fact ${id} is not allowed for ${persona}.`);
    }
    factIds.add(id);
  }

  const bulletCount = doc.experience.reduce((sum, role) => sum + role.bullets.length, 0);
  const covered = doc.experience.reduce(
    (sum, role) => sum + role.bullets.filter((bullet) => bullet.factIds.length > 0).length,
    0,
  );
  if (bulletCount === 0 || covered / bulletCount < 1) {
    errors.push("Every bullet must cite at least one fact id.");
  }

  return { ok: errors.length === 0, errors, factIds: [...factIds] };
}

export function unsupportedAnswer(
  text: string,
  citedIds: string[],
  persona: Persona,
  approvedSkills: readonly string[] = [],
): string[] {
  const errors: string[] = [];
  checkProse(text, citedIds, persona, "any", "answer", errors, new Set(), approvedSkills);
  return errors;
}

function checkProse(
  text: string,
  citedIds: string[],
  persona: Persona,
  scope: string | "summary" | "any",
  label: string,
  errors: string[],
  factIds: Set<string>,
  approvedSkills: readonly string[] = [],
): void {
  if (citedIds.length === 0) {
    errors.push(`${label} has no fact ids.`);
    return;
  }
  const support: string[] = [];
  for (const id of citedIds) {
    const fact = factById(id);
    if (!fact) {
      errors.push(`${label} cites unknown fact ${id}.`);
      continue;
    }
    if (!factAllowed(fact.personas, persona)) {
      errors.push(`${label} cites ${id}, which is not allowed for ${persona}.`);
    }
    if (scope !== "summary" && scope !== "any" && fact.roleId !== scope) {
      errors.push(`${label} cites ${id}, which belongs to a different role.`);
    }
    if (scope === "summary" && fact.roleId !== null) {
      errors.push(`${label} cites role fact ${id}. Summary must cite profile facts only.`);
    }
    support.push(fact.text);
    factIds.add(id);
  }
  const supportText = support.join("\n");
  for (const value of numbersIn(text)) {
    if (!numbersIn(supportText).includes(value)) {
      errors.push(`${label} uses number ${value}, which is not in the cited facts.`);
    }
  }
  for (const term of GUARDED_TERMS) {
    if (
      mentions(text, term)
      && !mentions(supportText, term)
      && !approvedSkills.some((skill) => mentions(skill, term))
    ) {
      errors.push(`${label} mentions ${term}, which is not in the cited facts.`);
    }
  }
}

function factAllowed(personas: string[], persona: Persona): boolean {
  return personas.includes(persona) || personas.includes("both");
}

function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(haystack);
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isExactFact(text: string, ids: string[]): boolean {
  return ids.length === 1 && factById(ids[0])?.text === text;
}

/** Reject bullets that cite facts but read like a different claim (e.g. CaseEdge metrics under Boroda). */
function checkCitationAnchor(text: string, citedIds: string[], label: string, errors: string[]): void {
  if (citedIds.length === 0 || isExactFact(text, citedIds)) {
    return;
  }
  const support = citedIds.map((id) => factById(id)?.text ?? "").join(" ");
  if (!support.trim()) {
    return;
  }
  const hasSignal = /\d/.test(text) || GUARDED_TERMS.some((term) => mentions(text, term));
  if (!hasSignal) {
    return;
  }
  const score = tokenOverlap(text, support);
  if (score < 0.22) {
    errors.push(`${label} is not anchored to its cited facts (overlap ${(score * 100).toFixed(0)}%).`);
  }
}

function tokenOverlap(left: string, right: string): number {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3),
    );
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0) {
    return 1;
  }
  let shared = 0;
  for (const word of a) {
    if (b.has(word)) {
      shared += 1;
    }
  }
  return shared / a.size;
}

export function renderedFactIds(doc: CvDocument): string[] {
  return validateCv(doc, "technical").factIds;
}

/** Keep skills within quality-gate bounds using the closed SKILL list. */
export function normalizeSelectedSkills(doc: CvDocument, persona: Persona): void {
  const allowed = personaDefaults[persona].skills;
  const picked: string[] = [];
  for (const skill of doc.selectedSkills) {
    if (SKILL_SET.has(skill) && !picked.includes(skill)) {
      picked.push(skill);
    }
  }
  for (const skill of allowed) {
    if (picked.length >= 3) {
      break;
    }
    if (!picked.includes(skill)) {
      picked.push(skill);
    }
  }
  doc.selectedSkills = picked.slice(0, 18);
}

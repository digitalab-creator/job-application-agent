import { HEADLINES, SKILLS, factById, roleById } from "../profile/facts.js";
import type { CvDocument, Persona } from "../models/types.js";

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
];

const SKILL_SET = new Set<string>(SKILLS);

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  factIds: string[];
};

export function validateCv(doc: CvDocument, persona: Persona): ValidationResult {
  const errors: string[] = [];
  const factIds = new Set<string>();

  if (persona === "marketing" && doc.headlineId !== "marketing-full") {
    errors.push("Marketing persona must use the marketing headline.");
  }
  if (persona === "technical" && doc.headlineId !== "tech-full") {
    errors.push("Technical persona must use the technical headline.");
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

  if (doc.experience.length < 3) {
    errors.push("CV must include at least 3 roles.");
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
      checkProse(bullet.text, bullet.factIds, persona, role.roleId, `${record.company} bullet ${index + 1}`, errors, factIds);
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

export function unsupportedAnswer(text: string, citedIds: string[], persona: Persona): string[] {
  const errors: string[] = [];
  checkProse(text, citedIds, persona, "any", "answer", errors, new Set());
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
    if (mentions(text, term) && !mentions(supportText, term)) {
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

export function renderedFactIds(doc: CvDocument): string[] {
  return validateCv(doc, "technical").factIds;
}

import assert from "node:assert/strict";
import test from "node:test";
import type { CvDocument, Persona } from "../models/types.js";
import type { JobRequirements } from "../application/job-fit.js";
import { evaluateCvRelevance, validateCvQuality } from "./relevance.js";

function requirements(overrides: Partial<JobRequirements> = {}): JobRequirements {
  return {
    roleFamily: "technical",
    seniority: "senior",
    mustHaveSkills: ["Python", "backend APIs", "RAG"],
    preferredSkills: ["microservices"],
    responsibilities: ["Build production AI systems"],
    yearsRequired: 5,
    location: "Israel",
    workMode: "hybrid",
    languageRequirements: [],
    educationRequirements: [],
    managementRequirement: false,
    domainRequirements: ["AI"],
    hardBlockers: [],
    ...overrides,
  };
}

function doc(persona: Persona, skills: string[], factIds: string[], summary: string): CvDocument {
  return {
    headlineId: persona === "marketing" ? "marketing-full" : "tech-full",
    summary,
    summaryFactIds: [persona === "marketing" ? "summary-marketing" : "summary-technical"],
    selectedSkills: skills,
    experience: [{
      roleId: "caseedge",
      title: "Independent Applied AI Engineer & Product Builder",
      bullets: [{ factIds, text: summary }],
    }],
    educationFactIds: [],
    includePortfolio: false,
  };
}

test("Applied AI Engineer CV emphasizes supported production AI evidence", () => {
  const result = evaluateCvRelevance(
    doc("technical", ["Python", "RAG", "REST APIs", "Microservices"], ["caseedge-production", "caseedge-stack"], "Built production RAG and backend APIs with Python, microservices, and semantic search."),
    requirements(),
    "technical",
  );
  assert.equal(result.decision, "pass");
  assert.ok(result.mustHaveCoverage >= 65);
});

test("Backend Python Engineer CV passes without keyword stuffing", () => {
  const result = evaluateCvRelevance(
    doc("technical", ["Python", "FastAPI", "REST APIs"], ["screening-python-backend", "fullpower-build"], "Built backend services, APIs, and internal tools with Python."),
    requirements({ mustHaveSkills: ["Python", "backend APIs"], preferredSkills: [], responsibilities: ["Build backend services"] }),
    "technical",
  );
  assert.equal(result.decision, "pass");
});

test("AI Solutions Engineer and architect roles can pass on verified evidence", () => {
  const result = evaluateCvRelevance(
    doc("technical", ["Python", "RAG", "Microservices", "REST APIs"], ["caseedge-stack", "boroda-platform"], "Architected and built production AI systems and microservices."),
    requirements({ mustHaveSkills: ["AI systems", "microservices", "APIs"], responsibilities: ["Architect customer solutions"] }),
    "technical",
  );
  assert.equal(result.decision, "pass");
});

test("Growth Engineer and Martech CV uses both technical and growth evidence", () => {
  const result = evaluateCvRelevance(
    doc("hybrid", ["Python", "APIs", "Google Ads", "GA4"], ["caseedge-stack", "caseedge-campaigns", "fullpower-tracking"], "Built APIs and automation while leading paid acquisition measurement and CRO."),
    requirements({ roleFamily: "hybrid", mustHaveSkills: ["APIs", "automation", "paid acquisition"], preferredSkills: ["GA4"], responsibilities: ["Connect growth data to technical systems"] }),
    "hybrid",
  );
  assert.equal(result.decision, "pass");
});

test("Performance Marketing Lead CV emphasizes acquisition and measurement", () => {
  const result = evaluateCvRelevance(
    doc("marketing", ["Google Ads", "Meta Ads", "Budget pacing", "Conversion optimization"], ["summary-marketing", "media-hands-on", "caseedge-campaigns"], "Managed paid acquisition, budgets, measurement, and conversion optimization across Google and Meta."),
    requirements({ roleFamily: "marketing", mustHaveSkills: ["paid acquisition", "Google Ads", "measurement"], preferredSkills: ["CRO"], responsibilities: ["Lead campaign and budget management"] }),
    "marketing",
  );
  assert.equal(result.decision, "pass");
});

test("Growth Manager CV emphasizes growth outcomes rather than RAG", () => {
  const result = evaluateCvRelevance(
    doc("marketing", ["Google Ads", "ROAS", "Conversion optimization"], ["summary-marketing", "caseedge-advisory", "boroda-cpa"], "Led acquisition strategy, CRO, measurement, and performance improvement."),
    requirements({ roleFamily: "marketing", mustHaveSkills: ["paid acquisition", "CRO", "measurement"], preferredSkills: [], responsibilities: ["Lead growth strategy"] }),
    "marketing",
  );
  assert.equal(result.decision, "pass");
});

test("Marketing Technology tracker roles use hybrid MarTech CV evidence", () => {
  const result = evaluateCvRelevance(
    doc("hybrid", ["GTM", "Google Ads", "APIs", "Workflow automation"], ["fullpower-tracking", "klogic-workflows", "caseedge-stack"], "Led marketing operations, tracking architecture, and automation across paid and data systems."),
    requirements({ roleFamily: "hybrid", mustHaveSkills: ["marketing automation", "tracking", "APIs"], preferredSkills: ["Google Ads"], responsibilities: ["Run MarTech stack"] }),
    "hybrid",
  );
  assert.equal(result.decision, "pass");
});

test("Analytics and CRO CV passes on verified measurement evidence", () => {
  const result = evaluateCvRelevance(
    doc("marketing", ["GA4", "GTM", "Funnel analysis", "Conversion optimization"], ["caseedge-advisory", "caseedge-campaigns"], "Improved funnel performance through tracking, analysis, experimentation, and CRO."),
    requirements({ roleFamily: "marketing", mustHaveSkills: ["measurement", "funnel analysis", "conversion optimization"], preferredSkills: [], responsibilities: ["Analyze conversion funnels"] }),
    "marketing",
  );
  assert.equal(result.decision, "pass");
});

test("xEngineer-style JD phrases match verified AI engineering evidence", () => {
  const result = evaluateCvRelevance(
    doc(
      "technical",
      ["Python", "AI agents", "Microservices", "REST APIs"],
      ["caseedge-stack", "caseedge-production"],
      "Built production AI software, owned end-to-end features, and led technical delivery across cross-functional teams on large-scale SaaS platforms.",
    ),
    requirements({
      mustHaveSkills: ["AI engineering", "end-to-end feature ownership", "complex technical project leadership"],
      preferredSkills: ["cross-functional communication"],
      responsibilities: ["AI-enabled website creation and editing", "large-scale editor systems"],
    }),
    "technical",
  );
  assert.equal(result.decision, "pass");
});

test("Java-only senior engineering role does not pass a Python CV", () => {
  const result = evaluateCvRelevance(
    doc("technical", ["Python", "RAG"], ["screening-python-backend"], "Built Python backend and AI systems."),
    requirements({ mustHaveSkills: ["Java", "Spring"], preferredSkills: [], responsibilities: ["Build Java services"] }),
    "technical",
  );
  assert.notEqual(result.decision, "pass");
});

test("CV structure rejects duplicate bullets and an overlong skills section", () => {
  const candidate = doc("technical", Array.from({ length: 19 }, (_, index) => `Skill ${index}`), ["caseedge-stack"], "A valid summary with supported evidence.");
  candidate.experience[0]!.bullets.push(candidate.experience[0]!.bullets[0]!);
  const quality = validateCvQuality(candidate, "technical");
  assert.equal(quality.ok, false);
  assert.ok(quality.issues.includes("skills_section_length"));
  assert.ok(quality.issues.includes("duplicate_bullets"));
});

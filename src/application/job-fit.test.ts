import assert from "node:assert/strict";
import test from "node:test";
import { evaluateJobFit, type JobFitAnalysis } from "./job-fit.js";
import { facts } from "../profile/facts.js";

function analysis(overrides: Partial<JobFitAnalysis> = {}): JobFitAnalysis {
  return {
    requirements: {
      roleFamily: "technical",
      seniority: "senior",
      mustHaveSkills: ["Python", "backend APIs", "production AI"],
      preferredSkills: ["RAG"],
      responsibilities: ["Build production services"],
      yearsRequired: 5,
      location: "Israel",
      workMode: "hybrid",
      languageRequirements: ["English"],
      educationRequirements: [],
      managementRequirement: false,
      domainRequirements: ["AI"],
      hardBlockers: [],
    },
    persona: "technical",
    requirementEvidence: [
      { requirement: "Python", factIds: ["screening-python-backend"], status: "supported" },
      { requirement: "backend APIs", factIds: ["screening-python-backend"], status: "supported" },
      { requirement: "production AI", factIds: ["caseedge-production", "caseedge-stack"], status: "supported" },
    ],
    matchedMustHaves: ["Python", "backend APIs", "production AI"],
    matchedPreferred: ["RAG"],
    matchedFactIds: ["screening-python-backend", "caseedge-production", "caseedge-stack"],
    missingMustHaves: [],
    risks: [],
    strongestEvidence: ["CaseEdge production platform"],
    reason: "The candidate has verified production AI and backend evidence.",
    ...overrides,
  };
}

test("strong applied AI fit passes", () => {
  const result = evaluateJobFit(analysis());
  assert.equal(result.decision, "apply");
  assert.ok(result.fitScore >= 70);
});

test("central unsupported Java requirement is skipped", () => {
  const result = evaluateJobFit(analysis({
    requirements: {
      ...analysis().requirements,
      mustHaveSkills: ["Java", "Spring"],
      hardBlockers: ["Java and Spring are central mandatory requirements."],
    },
    requirementEvidence: [
      { requirement: "Java", factIds: [], status: "missing" },
      { requirement: "Spring", factIds: [], status: "missing" },
    ],
    matchedMustHaves: [],
    matchedPreferred: [],
    matchedFactIds: [],
    missingMustHaves: ["Java", "Spring"],
  }));
  assert.equal(result.decision, "skip");
});

test("a listed bachelor degree does not block a supported fit", () => {
  const result = evaluateJobFit(analysis({
    missingMustHaves: ["Bachelor of Science in Computer Science or related field"],
    requirementEvidence: [
      ...analysis().requirementEvidence,
      { requirement: "Bachelor of Science in Computer Science or related field", factIds: [], status: "missing" },
    ],
    requirements: {
      ...analysis().requirements,
      educationRequirements: ["B.Sc. in Computer Science or equivalent"],
    },
  }));
  assert.equal(result.decision, "apply");
  assert.equal(
    result.missingMustHaves.some((item) => /bachelor/i.test(item)),
    false,
  );
});

test("office software and soft traits do not block a supported fit", () => {
  const result = evaluateJobFit(analysis({
    missingMustHaves: ["Google Sheets", "High attention to detail"],
    requirementEvidence: [
      ...analysis().requirementEvidence,
      { requirement: "Google Sheets", factIds: [], status: "missing" },
      { requirement: "High attention to detail", factIds: [], status: "missing" },
    ],
  }));
  assert.equal(result.decision, "apply");
  assert.equal(result.missingMustHaves.includes("Google Sheets"), false);
  assert.match(result.risks.join(" "), /Google Sheets/);
});

test("a verified mentoring fact covers a team-development must-have", () => {
  const result = evaluateJobFit(analysis({
    missingMustHaves: ["Team management and development"],
    requirementEvidence: [
      ...analysis().requirementEvidence,
      { requirement: "Team management and development", factIds: [], status: "missing" },
    ],
  }));
  assert.equal(result.decision, "apply");
  assert.equal(result.missingMustHaves.includes("Team management and development"), false);
  assert.match(result.risks.join(" "), /mentoring or training/);
});

test("supervisor wording in verified facts covers team management must-haves", () => {
  const withSupervisor = facts.filter((fact) => fact.verified);
  const result = evaluateJobFit(analysis({
    missingMustHaves: ["Team management and development"],
    requirementEvidence: [
      ...analysis().requirementEvidence,
      { requirement: "Team management and development", factIds: [], status: "missing" },
    ],
  }), withSupervisor);
  assert.equal(result.missingMustHaves.includes("Team management and development"), false);
});

test("junior or internship role is never autonomously applied", () => {
  const result = evaluateJobFit(analysis({
    requirements: { ...analysis().requirements, seniority: "intern" },
  }));
  assert.equal(result.decision, "skip");
});

test("unrelated profession is skipped even with a stray matching fact", () => {
  const result = evaluateJobFit(analysis({
    requirements: { ...analysis().requirements, roleFamily: "other", hardBlockers: ["Unrelated profession."] },
  }));
  assert.equal(result.decision, "skip");
  assert.equal(result.persona, null);
});


test("a supported requirement must have grounded evidence, not merely an LLM matched label", () => {
  const base = analysis();
  const result = evaluateJobFit(analysis({
    requirementEvidence: base.requirementEvidence.filter((row) => row.requirement !== "backend APIs"),
    matchedMustHaves: ["Python", "backend APIs", "production AI"],
    missingMustHaves: [],
  }));
  assert.equal(result.decision, "skip");
  assert.ok(result.missingMustHaves.includes("backend APIs"));
});

test("contradictory missing labels never override a supported evidence row", () => {
  const result = evaluateJobFit(analysis({missingMustHaves: ["Python"]}));
  assert.equal(result.decision, "apply");
  assert.ok(!result.missingMustHaves.includes("Python"));
});

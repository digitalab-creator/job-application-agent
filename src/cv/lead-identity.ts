import type { Persona } from "../models/types.js";
import { HEADLINES } from "../profile/facts.js";
import { normalizeTrackerCategory } from "../discovery/tracker-categories.js";
import { personaDefaults } from "./persona.js";

/** How the CV and screening answers should read for this application. */
export type LeadIdentity = "performance" | "revenue_martech" | "applied_ai";

export type HeadlineId = keyof typeof HEADLINES;

const TRACKER_TO_LEAD = new Map<string, LeadIdentity>([
  ["Performance Marketing Leadership", "performance"],
  ["Analytics & CRO", "performance"],
  ["Revenue Systems", "revenue_martech"],
  ["Marketing Technology", "revenue_martech"],
  ["Applied AI", "applied_ai"],
  ["AI Solutions", "applied_ai"],
]);

export function leadIdentityForTrackerCategory(category: string): LeadIdentity | null {
  const canonical = normalizeTrackerCategory(category);
  return TRACKER_TO_LEAD.get(canonical) ?? null;
}

export function resolveLeadIdentity(input: {
  trackerCategory?: string;
  persona: Persona;
}): LeadIdentity {
  const fromSheet = input.trackerCategory?.trim()
    ? leadIdentityForTrackerCategory(input.trackerCategory)
    : null;
  // The full-job-description fit selects the final persona. A stale tracker category
  // may suggest a different lane: do not let it force a misleading CV headline.
  if (fromSheet) {
    if (input.persona === "technical" && fromSheet !== "applied_ai") return "applied_ai";
    if (input.persona === "marketing" && fromSheet === "applied_ai") return "performance";
    return fromSheet;
  }
  if (input.persona === "marketing") {
    return "performance";
  }
  if (input.persona === "technical") {
    return "applied_ai";
  }
  return "revenue_martech";
}

export function headlineForLeadIdentity(identity: LeadIdentity): HeadlineId {
  if (identity === "performance") {
    return "marketing-full";
  }
  if (identity === "revenue_martech") {
    return "revenue-martech-full";
  }
  return "tech-full";
}

export function summaryFactIdForLeadIdentity(identity: LeadIdentity): string {
  if (identity === "performance") {
    return "summary-marketing";
  }
  if (identity === "revenue_martech") {
    return "summary-revenue-martech";
  }
  return "summary-technical";
}

export function personasForLeadIdentity(identity: LeadIdentity): Persona[] {
  if (identity === "performance") {
    return ["marketing", "hybrid"];
  }
  if (identity === "applied_ai") {
    return ["technical", "hybrid"];
  }
  return ["hybrid", "marketing", "technical"];
}

export function cvUsedLabelForLeadIdentity(identity: LeadIdentity): "marketing" | "technical" | "hybrid" {
  if (identity === "performance") {
    return "marketing";
  }
  if (identity === "applied_ai") {
    return "technical";
  }
  return "hybrid";
}

export function leadIdentityGuidance(identity: LeadIdentity): string {
  if (identity === "performance") {
    return "Lead identity: performance marketing — open with paid acquisition, budgets, measurement, and results. Do not open with RAG, backend architecture, or production LLM engineering.";
  }
  if (identity === "revenue_martech") {
    return "Lead identity: revenue & MarTech — show how you connect marketing, CRM, data, GTM, and operations (tracking, automation, integrations). Cite verified CRM facts (built custom CRM, multiple platform integrations). Never claim HubSpot — candidate has not used it.";
  }
  return "Lead identity: applied AI — lead with production engineering, shipped AI product delivery, and demonstrated stack (RAG, APIs, microservices). De-emphasize campaign management and media budgets unless tied to a technical build.";
}

export function skillsForLeadIdentity(identity: LeadIdentity): string[] {
  if (identity === "performance") {
    return personaDefaults.marketing.skills;
  }
  if (identity === "applied_ai") {
    return personaDefaults.technical.skills;
  }
  return personaDefaults.hybrid.skills;
}

export function personaForRoleTitles(identity: LeadIdentity): Persona {
  if (identity === "performance") {
    return "marketing";
  }
  if (identity === "applied_ai") {
    return "technical";
  }
  return "hybrid";
}

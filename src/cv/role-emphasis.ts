import type { LeadIdentity } from "./lead-identity.js";
import { leadIdentityGuidance } from "./lead-identity.js";

export type JobEmphasis = {
  primaryTags: string[];
  deemphasizeTags: string[];
  guidance: string;
  leadIdentity: LeadIdentity;
};

export function jobEmphasisForLeadIdentity(identity: LeadIdentity, role: string, jobText: string): JobEmphasis {
  const text = `${role} ${jobText}`.toLowerCase();
  const base = leadIdentityGuidance(identity);
  if (identity === "performance") {
    return {
      leadIdentity: identity,
      primaryTags: ["ppc", "measurement", "budgets", "cro", "acquisition"],
      deemphasizeTags: ["rag", "microservices", "llm"],
      guidance: `${base} Prefer facts tagged ppc, measurement, growth. Use CaseEdge as GTM/product context only when relevant.`,
    };
  }
  if (identity === "revenue_martech") {
    return {
      leadIdentity: identity,
      primaryTags: ["martech", "gtm", "revops", "tracking", "automation", "apis"],
      deemphasizeTags: [],
      guidance: `${base} Prefer facts about tracking architecture, workflows, platforms (Budget Watch), and integrations — not a laundry list of campaign tactics.`,
    };
  }
  const backendHeavy = /backend|llm|rag|software engineer|full[- ]?stack|microservice|python engineer/.test(text);
  return {
    leadIdentity: identity,
    primaryTags: ["ai", "backend", "rag", "product", "microservices", "automation"],
    deemphasizeTags: ["ppc", "media planning"],
    guidance: `${base} Prefer CaseEdge production, stack, and engineering facts.${backendHeavy ? "" : " Include solutions/architecture angles when the role is customer-facing."}`,
  };
}

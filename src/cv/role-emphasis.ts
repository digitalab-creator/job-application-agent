import type { Persona } from "../models/types.js";

export type JobEmphasis = {
  primaryTags: string[];
  deemphasizeTags: string[];
  guidance: string;
};

/** Steers fact selection so a backend posting does not read like a PPC resume. */
export function jobEmphasis(role: string, jobText: string, persona: Persona): JobEmphasis {
  const text = `${role} ${jobText}`.toLowerCase();
  const backend = /backend|ai\/ml|ml engineer|llm|rag|software engineer|full[- ]?stack|microservice|python engineer|applied ai/;
  const marketing = /ppc|performance marketing|paid acquisition|growth manager|martech|cro\b|media planning/;
  if (persona === "marketing" || (marketing.test(text) && !backend.test(text))) {
    return {
      primaryTags: ["ppc", "measurement", "growth", "martech"],
      deemphasizeTags: ["rag", "microservices"],
      guidance:
        "Lead with paid acquisition, measurement, budgets, and campaign outcomes. Use CaseEdge only as product/go-to-market context, not as a deep backend/RAG story.",
    };
  }
  if (backend.test(text) || persona === "technical") {
    return {
      primaryTags: ["ai", "backend", "rag", "fullstack", "microservices", "product", "automation"],
      deemphasizeTags: ["ppc"],
      guidance:
        "Lead with production AI, backend, RAG, OCR, microservices, and shipping product (especially CaseEdge and ROI Me). Do not lead with Cellcom PPC management, agency budgets, or generic paid-media campaign work unless rewritten inside a technical automation fact.",
    };
  }
  return {
    primaryTags: ["ai", "automation", "ppc", "fullstack"],
    deemphasizeTags: [],
    guidance: "Balance technical delivery with growth outcomes. Pick facts that match both sides of the role.",
  };
}

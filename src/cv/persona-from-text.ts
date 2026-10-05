import type { Persona } from "../models/types.js";

const TECHNICAL = /applied ai|ai engineer|llm|rag|backend|full[- ]?stack|software engineer|ml engineer|automation engineer|data engineer|python|microservices|api design|platform engineer/;
const MARKETING = /ppc|performance marketing|performance manager|paid acquisition|user acquisition|growth manager|cro\b|performance lead|paid ads|campaign|media buying/;
const HYBRID = /solutions engineer|solutions architect|product manager|growth engineer|technical growth|martech|marketing operations|revops|revenue operations|marketing technology|ai growth/;

export function choosePersonaFromText(role: string, category: string, jobText: string): Persona | null {
  const title = `${role} ${category}`.toLowerCase();
  const text = `${title} ${jobText}`.toLowerCase();
  const titleTechnical = countMatches(title, TECHNICAL);
  const titleMarketing = countMatches(title, MARKETING);
  if (HYBRID.test(title)) {
    return "hybrid";
  }
  if (titleMarketing > titleTechnical && titleMarketing > 0) {
    return "marketing";
  }
  if (titleTechnical > titleMarketing && titleTechnical > 0) {
    return "technical";
  }
  const technical = countMatches(text, TECHNICAL);
  const marketing = countMatches(text, MARKETING);
  if (technical > 0 && marketing > 0) {
    return "hybrid";
  }
  if (marketing > technical && marketing > 0) {
    return "marketing";
  }
  if (technical > marketing && technical > 0) {
    return "technical";
  }
  return null;
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`));
  return matches?.length ?? 0;
}

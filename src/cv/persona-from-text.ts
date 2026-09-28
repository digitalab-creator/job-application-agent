import type { Persona } from "../models/types.js";

const TECHNICAL = /applied ai|ai engineer|llm|rag|backend engineer|full stack|fullstack|software engineer|ml engineer|automation engineer/;
const MARKETING = /ppc|performance marketing|performance manager|paid acquisition|user acquisition|growth manager|cro\b|marketing automation|performance lead|paid ads/;
const HYBRID = /growth engineer|technical growth|martech engineer|ai growth|marketing technology/;

export function choosePersonaFromText(role: string, category: string, jobText: string): Persona {
  const title = `${role} ${category}`.toLowerCase();
  const text = `${title} ${jobText}`.toLowerCase();
  if (HYBRID.test(title)) {
    return "hybrid";
  }
  if (MARKETING.test(title) && !TECHNICAL.test(title)) {
    return "marketing";
  }
  if (HYBRID.test(text) || (TECHNICAL.test(text) && MARKETING.test(text))) {
    return "hybrid";
  }
  if (MARKETING.test(text)) {
    return "marketing";
  }
  return "technical";
}

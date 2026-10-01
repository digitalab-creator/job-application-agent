import { candidate } from "./candidate.js";
import type { Persona } from "../models/types.js";

export function screeningMotivation(persona: Persona): string {
  if (persona === "marketing") {
    return candidate.screening.motivationMarketing;
  }
  if (persona === "technical") {
    return candidate.screening.motivationTechnical;
  }
  return candidate.screening.motivationHybrid;
}

/** Short ATS motivation fields — not long cover letters or “tell us about yourself”. */
export function isShortMotivationField(label: string, nameIdBlob: string): boolean {
  const blob = `${label} ${nameIdBlob}`.toLowerCase();
  if (/human-reason|human_reason/.test(blob)) {
    return true;
  }
  if (/tell us about|about yourself|cover letter|letter of motivation/i.test(label)) {
    return false;
  }
  if (/^why do you want|reason for applying|what motivates you/i.test(label.trim())) {
    return label.length < 160;
  }
  return /motivation/i.test(label) && label.length < 120;
}

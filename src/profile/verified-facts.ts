import type { Fact, Persona } from "../models/types.js";
import { facts } from "./facts.js";

/** Static verified pool only — never includes LLM-learned screening rows (avoids compounding errors). */
export function verifiedFactsForPersona(persona: Persona): Fact[] {
  return facts.filter((fact) => fact.personas.includes(persona) || fact.personas.includes("both"));
}

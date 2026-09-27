import { candidate } from "../config/candidate.js";
import type { CvDocument, Persona, PortfolioKey } from "../models/types.js";
import { portfolioFor } from "./persona.js";

export function portfolioUrlForDoc(doc: Pick<CvDocument, "includePortfolio" | "portfolioKey">, persona: Persona): string {
  if (!doc.includePortfolio) {
    return "";
  }
  const key: PortfolioKey = doc.portfolioKey ?? portfolioFor(persona);
  return candidate.portfolio[key];
}

import type { CvDocument, Persona } from "../models/types.js";
import { validateCv } from "../cv/validate.js";
import { z } from "zod";

/** One row: job requirement → verified fact IDs → supported or missing (model decides semantics; code validates IDs). */
export const requirementEvidenceRowSchema = z.object({
  requirement: z.string().max(240),
  factIds: z.array(z.string()).max(12),
  status: z.enum(["supported", "missing"]),
});

export type RequirementEvidenceRow = z.infer<typeof requirementEvidenceRowSchema>;

export function validateRequirementEvidence(
  rows: RequirementEvidenceRow[],
  verifiedFactIds: Set<string>,
): {
  supportedRows: RequirementEvidenceRow[];
  missingRequirements: string[];
  invalidFactIds: string[];
} {
  const missingRequirements: string[] = [];
  const invalidFactIds: string[] = [];
  const supportedRows: RequirementEvidenceRow[] = [];

  for (const row of rows) {
    const requirement = row.requirement.trim();
    if (!requirement) {
      continue;
    }
    if (row.status === "missing") {
      missingRequirements.push(requirement);
      continue;
    }
    const factIds = row.factIds.map((id) => id.trim()).filter(Boolean);
    const bad = factIds.filter((id) => !verifiedFactIds.has(id));
    if (bad.length > 0) {
      invalidFactIds.push(...bad);
      continue;
    }
    if (factIds.length === 0) {
      missingRequirements.push(requirement);
      continue;
    }
    supportedRows.push({ requirement, factIds, status: "supported" });
  }

  return {
    supportedRows,
    missingRequirements: [...new Set(missingRequirements)],
    invalidFactIds: [...new Set(invalidFactIds)],
  };
}

export function cvFactIds(doc: CvDocument, persona: Persona): Set<string> {
  return new Set(validateCv(doc, persona).factIds);
}

/** After fit passes, CV must cite at least one fact per supported requirement row. */
export function validateCvCoversEvidence(
  doc: CvDocument,
  persona: Persona,
  supportedRows: RequirementEvidenceRow[],
): { ok: boolean; missingRequirements: string[] } {
  const ids = cvFactIds(doc, persona);
  const missingRequirements = supportedRows
    .filter((row) => !row.factIds.some((id) => ids.has(id)))
    .map((row) => row.requirement);
  return { ok: missingRequirements.length === 0, missingRequirements };
}

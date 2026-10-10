import type { CvDocument, Persona } from "../models/types.js";
import { cvMayCiteFact, validateCv } from "../cv/validate.js";
import { factById } from "../profile/facts.js";
import { z } from "zod";

const MAX_ROLE_BULLETS = 5;

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
/**
 * Put each supported requirement's fact on the CV.
 * Profile facts go on the summary. Role facts become a verbatim bullet.
 * The wording is the verified fact text, so this cannot invent a claim.
 */
export function citeSupportedEvidence(
  doc: CvDocument,
  persona: Persona,
  rows: RequirementEvidenceRow[],
): void {
  const cited = cvFactIds(doc, persona);
  const required = new Set(rows.flatMap((row) => row.factIds));
  for (const row of rows) {
    if (row.status !== "supported" || row.factIds.some((id) => cited.has(id))) {
      continue;
    }
    const factId = row.factIds.find((id) => cvMayCiteFact(id, persona));
    if (!factId) {
      continue;
    }
    const fact = factById(factId);
    if (!fact) {
      continue;
    }
    if (!fact.roleId) {
      if (!doc.summaryFactIds.includes(factId)) {
        doc.summaryFactIds.push(factId);
      }
      cited.add(factId);
      continue;
    }
    const role = doc.experience.find((item) => item.roleId === fact.roleId);
    if (!role) {
      continue;
    }
    if (role.bullets.length >= MAX_ROLE_BULLETS) {
      const dropAt = role.bullets.findIndex((bullet) => !bullet.factIds.some((id) => required.has(id)));
      if (dropAt < 0) {
        continue;
      }
      role.bullets.splice(dropAt, 1);
    }
    role.bullets.push({ factIds: [factId], text: fact.text });
    cited.add(factId);
  }
}

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

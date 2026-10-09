import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";

export type OpportunityKind = "employment" | "contract" | "freelance_project";

const FREELANCE_SOURCE_HINTS = /xplace|freelancer|פרילנס|project\s*bid|מכרז/i;

export function opportunityKindFromRow(row: JobSheetRow): OpportunityKind {
  const explicit = String(row["Opportunity Kind"] ?? row["Opportunity kind"] ?? "").trim().toLowerCase();
  if (explicit === "freelance_project" || explicit === "freelance" || explicit === "project") {
    return "freelance_project";
  }
  if (explicit === "contract" || explicit === "freelance_contract") {
    return "contract";
  }
  if (explicit === "employment" || explicit === "job") {
    return "employment";
  }
  const source = String(row.Source ?? "").trim();
  const notes = String(row.Notes ?? "").trim();
  const category = String(row.Category ?? "").trim();
  if (
    FREELANCE_SOURCE_HINTS.test(source)
    || FREELANCE_SOURCE_HINTS.test(notes)
    || category === "Freelance Project"
  ) {
    return "freelance_project";
  }
  return "employment";
}

export function isFreelanceOpportunity(row: JobSheetRow): boolean {
  const kind = opportunityKindFromRow(row);
  return kind === "freelance_project" || kind === "contract";
}

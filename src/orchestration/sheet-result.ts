import type { ApplicationResult } from "../models/types.js";
import type { JobSheetRow } from "./sheets/job-sheet.js";

const STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  agency_registered: "Agency Registered",
  agency_job_referred: "Agency Referred",
  closed: "Closed",
  not_relevant: "Not Relevant",
  no_suitable_replacement: "Not Relevant",
  review: "Review",
  failed: "Review",
  invalid_url: "Review",
  confirmation_not_detected: "Review",
  already_submitted: "Review",
  location_ineligible: "Not Relevant",
  manual_required: "Manual",
};

const BLOCKER_STATUS: Record<string, string> = {
  access_blocked: "Review",
  job_description_unavailable: "Review",
  login_wall: "Manual",
  non_specific_posting: "Not Relevant",
};

export function mapApplyResultToSheetPatch(
  src: JobSheetRow,
  res: ApplicationResult,
  timezone: string,
): Record<string, string> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  if (res.status === "budget_reached" || res.status === "quota_reached") {
    return {
      Status: "New",
      "Applied Date": String(src["Applied Date"] ?? ""),
      Notes: String(src.Notes ?? ""),
    };
  }
  const status =
    res.blocker === "captcha"
      ? "Manual"
      : (res.blocker && BLOCKER_STATUS[res.blocker])
        ?? (STATUS_LABELS[res.status] ?? "Review");
  const notes = [
    res.notes || "Worker returned no notes.",
    res.attemptId ? `attempt_id=${res.attemptId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const appliedDate =
    status === "Applied" || status === "Agency Referred"
      ? (String(res.appliedAt ?? "").slice(0, 10) || today)
      : String(src["Applied Date"] ?? "");
  return {
    Status: status,
    "Applied Date": appliedDate,
    Notes: notes,
    "Job URL": res.canonicalJobUrl ?? String(src["Job URL"] ?? ""),
  };
}

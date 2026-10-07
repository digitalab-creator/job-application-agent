import { getExcludedLocations, textMatchesExcludedLocation } from "./exclude-location.js";
import { candidate } from "../config/candidate.js";
import { normalizeLocationAliases } from "../discovery/location-aliases.js";
import { FOREIGN_LOCATION, matchesAny, ON_SITE_ACCEPTABLE, OTHER_ISRAEL_REGIONS } from "../discovery/location-geography.js";

/** ATS screening: willingness to commute / hybrid in-office days. */
export const OFFICE_COMMUTE_QUESTION =
  /comfortable\s+commut|commut(?:e|ing)\s+to\s+(?:our\s+)?(?:the\s+)?office|(?:\d+|three|two|four|five)\s+days?\s+(?:a|per)\s+week\s+(?:in|at)\s+(?:the\s+)?office|days?\s+(?:a|per)\s+week\s+in\s+(?:the\s+)?office|hybrid\s+work|in[- ]office\s+(?:presence|attendance|requirement)|work\s+from\s+(?:the\s+)?office|on[- ]site\s+(?:\d+|three|two|four|five)\s+days?/i;

export function isOfficeCommuteQuestion(label: string): boolean {
  return OFFICE_COMMUTE_QUESTION.test(label.trim());
}

function commuteContextBlob(label: string, extra?: string): string {
  return normalizeLocationAliases(`${label} ${extra ?? ""}`.replace(/\s+/g, " ").trim());
}

function mentionsExplicitIneligibleOffice(blob: string): boolean {
  const excluded = getExcludedLocations();
  if (textMatchesExcludedLocation(blob, excluded)) {
    return true;
  }
  const metro = matchesAny(ON_SITE_ACCEPTABLE, blob);
  if (matchesAny(FOREIGN_LOCATION, blob) && !metro) {
    return true;
  }
  return matchesAny(OTHER_ISRAEL_REGIONS, blob) && !metro;
}

/**
 * Yes when the candidate will commute to offices that match our pursue geography
 * (Central / Tel Aviv District metro, not excluded cities). Generic questions with
 * no named out-of-policy city default to Yes — we only open eligible roles.
 */
export function officeCommuteAnswerYes(label: string, extraContext = ""): boolean {
  if (!candidate.workLocation.willingToCommuteToEligibleOffices) {
    return false;
  }
  const blob = commuteContextBlob(label, extraContext);
  if (mentionsExplicitIneligibleOffice(blob)) {
    return false;
  }
  return true;
}

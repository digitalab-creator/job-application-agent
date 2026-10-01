import { getExcludedLocations, textMatchesExcludedLocation } from "./exclude-location.js";
import { candidate } from "../config/candidate.js";
import { normalizeLocationAliases } from "../discovery/location-aliases.js";

/** ATS screening: willingness to commute / hybrid in-office days. */
export const OFFICE_COMMUTE_QUESTION =
  /comfortable\s+commut|commut(?:e|ing)\s+to\s+(?:our\s+)?(?:the\s+)?office|(?:\d+|three|two|four|five)\s+days?\s+(?:a|per)\s+week\s+(?:in|at)\s+(?:the\s+)?office|days?\s+(?:a|per)\s+week\s+in\s+(?:the\s+)?office|hybrid\s+work|in[- ]office\s+(?:presence|attendance|requirement)|work\s+from\s+(?:the\s+)?office|on[- ]site\s+(?:\d+|three|two|four|five)\s+days?/i;

const OTHER_ISRAEL_OFFICE_ONLY = [
  /\bhaifa\b/i,
  /\bחיפה\b/,
  /\bjerusalem\b/i,
  /\bירושלים\b/,
  /\bbeer\s*sheva\b/i,
  /\bבאר\s*שבע\b/,
  /\bnetanya\b/i,
  /\bנתניה\b/,
  /\beilat\b/i,
  /\bאילת\b/,
];

const METRO_OFFICE = [
  /\btel\s*aviv\b/i,
  /\btel-?aviv\b/i,
  /\b(tlv|t\.l\.v)\b/i,
  /\bתל[\s-]?אביב\b/,
  /\bramat\s*gan\b/i,
  /\bpetah\s*tikva\b/i,
  /\bפתח\s*תקו?וה\b/,
  /\bherzliya\b/i,
  /\bהרצליה\b/,
  /\braanana\b/i,
  /\bרעננה\b/,
  /\bkfar\s*saba\b/i,
  /\bכפר\s*סבא\b/,
  /\bhod\s*hasharon\b/i,
  /\bholon\b/i,
  /\bחולון\b/,
  /\bgush\s*dan\b/i,
  /\bגוש\s*דן\b/,
  /\bcentral\s+district\b/i,
  /\bמרכז\b/,
  /\bsharon\b/i,
  /\bהשרון\b/,
];

const FOREIGN_OFFICE = [
  /\bunited\s+states\b/i,
  /\bu\.s\.a?\.?\b/i,
  /\bunited\s+kingdom\b/i,
  /\blondon\b/i,
  /\bnew\s+york\b/i,
  /\bberlin\b/i,
  /\bpoland\b/i,
  /\bwarsaw\b/i,
];

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
  if (FOREIGN_OFFICE.some((re) => re.test(blob)) && !METRO_OFFICE.some((re) => re.test(blob))) {
    return true;
  }
  const otherIsrael = OTHER_ISRAEL_OFFICE_ONLY.some((re) => re.test(blob));
  const metro = METRO_OFFICE.some((re) => re.test(blob));
  if (otherIsrael && !metro) {
    return true;
  }
  return false;
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

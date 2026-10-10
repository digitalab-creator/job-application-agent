/**
 * URL shape checks — whether a cell points at one posting vs a hub/search page.
 * Whether that posting is still live is link-liveness.ts.
 */

const HUB_TAIL_PATTERN = new RegExp(
  "/(?:careers?|jobs?|job-search|job_search|positions?|openings?|opportunities"
  + "|vacancy|vacancies|join-us|work-with-us|search|browse|listings?)$",
  "i",
);

const LISTING_TAXONOMY_PATTERN = new RegExp(
  "/(?:categor(?:y|ies)|industr(?:y|ies)|sectors?|professions?|fields?"
  + "|tags?|topics?|disciplines?|specializations?)(?:/|$)",
  "i",
);

const GENERIC_JOB_URL_PATTERNS = [
  /linkedin\.com\/jobs\/search/i,
  /indeed\.[^/]+\/(?:jobs|q-)/i,
  /alljobs\.co\.il\/SearchResults/i,
  /drushim\.co\.il\/(?:jobs|search)\?/i,
  /google\.[^/]+\/search/i,
  /facebook\.com\/groups\/[^/]+\/?$/i,
  /facebook\.com\/search/i,
];

export function urlPath(url: string): string {
  const match = String(url || "").trim().match(/^https?:\/\/[^/]+(\/[^?#]*)?/i);
  return match?.[1] ? match[1] : "/";
}

/** Strong posting ids: query ids, uuids, long numeric segments — not bare slugs. */
export function extractStrongJobId(url: string): string {
  const value = String(url || "").trim();
  const queryMatch = value.match(/[?&](?:jobid|job_id|gh_jid|requisitionid|reqid|position|id)=([^&#]+)/i);
  if (queryMatch?.[1]) {
    return decodeURIComponent(queryMatch[1]);
  }
  const uuidMatch = value.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  if (uuidMatch?.[0]) {
    return uuidMatch[0];
  }
  const numericMatches = value.replace(/[?#].*$/, "").match(/\d{5,}/g);
  if (numericMatches?.length) {
    return numericMatches[numericMatches.length - 1]!;
  }
  return "";
}

export function isListingHubUrl(url: string): boolean {
  const path = urlPath(url).replace(/\/+$/, "");
  if (!path) {
    return true;
  }
  if (HUB_TAIL_PATTERN.test(path)) {
    return true;
  }
  return LISTING_TAXONOMY_PATTERN.test(path) && !extractStrongJobId(url);
}

export function isSpecificJobUrl(url: string): boolean {
  const value = String(url || "").trim();
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  if (GENERIC_JOB_URL_PATTERNS.some((pattern) => pattern.test(value))) {
    return false;
  }
  return !isListingHubUrl(value);
}

export function isUnverifiableUrl(url: string): boolean {
  return /^https?:\/\/(?:[a-z0-9-]+\.)*facebook\.com\//i.test(String(url || "").trim());
}

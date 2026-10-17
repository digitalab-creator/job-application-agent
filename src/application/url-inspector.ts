/**
 * URL shape checks — whether a cell points at one posting vs a hub/search page.
 * Whether that posting is still live is link-liveness.ts.
 */

import { gotFriendsPostingIdFromUrl, normalizeAgencyHost } from "./submission-scope.js";
import { parseHttpUrl } from "./automatable-url.js";

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
  /gotfriends\.co\.il\/jobslobby\/[^/?#]+\/?(?:\?|$)/i,
  /jobmaster\.co\.il\/jobs\/.*\/q-/i,
  /drushim\.co\.il\/jobs\/category\/[^/]+\/?$/i,
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

/** Aggregator/search/category pages — shared by ATS capability and queue eligibility. */
export function isAggregatorListPage(href: string, pathname: string): boolean {
  if (/\/jobs\/view\/\d+/i.test(href)) {
    return false;
  }
  if (/jobpage\?positionId=/i.test(href) || /\/job\/\d+/i.test(pathname)) {
    return false;
  }
  if (/[?&](q|query|search|keywords|page|total)=/i.test(href)) {
    return true;
  }
  if (/\/(jobs|careers|jobslobby)\/?$/i.test(pathname)) {
    return true;
  }
  try {
    const host = new URL(href).hostname;
    if (normalizeAgencyHost(host) && /jobslobby/i.test(pathname) && !gotFriendsPostingIdFromUrl(href)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
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
  if (isListingHubUrl(value)) {
    return false;
  }
  const parsed = parseHttpUrl(value);
  if (parsed && isAggregatorListPage(parsed.toString(), parsed.pathname)) {
    return false;
  }
  return true;
}

export function isUnverifiableUrl(url: string): boolean {
  return /^https?:\/\/(?:[a-z0-9-]+\.)*facebook\.com\//i.test(String(url || "").trim());
}

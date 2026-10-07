/**
 * Discovery and apply pursue remote-from-Israel roles, or on-site/hybrid roles in Israel's Central District
 * or Tel Aviv District (incl. Sharon cities), minus the admin block list (application/exclude-location.ts).
 *
 * Geography lives in location-geography.ts. This file only decides.
 */
import {
  EXCLUDED_SCAN_CHARS,
  getExcludedLocations,
  textMatchesExcludedLocation,
} from "../application/exclude-location.js";
import {
  FOREIGN_LOCATION,
  firstMatch,
  hasIsraelContext,
  hebrewTerm,
  latinTerm,
  matchesAny,
  ON_SITE_ACCEPTABLE,
  OTHER_ISRAEL_REGIONS,
} from "./location-geography.js";
import { normalizeLocationAliases } from "./location-aliases.js";

/**
 * Bump when the rules change meaning. Cached verdicts made by older rules are ignored,
 * so a rules fix is not defeated by stale "ineligible" answers on disk.
 */
export const LOCATION_RULES_VERSION = 2;

const REMOTE_FROM_ISRAEL: readonly RegExp[] = [
  latinTerm(String.raw`remote[\s]+(?:from|in)[\s]+israel|work[\s]+from[\s]+israel|based[\s]+in[\s]+israel`),
  /\blocation\s*:\s*israel\b/i,
  latinTerm(String.raw`israel[\s]*[-–][\s]*remote|remote[\s]*[-–][\s]*israel|from[\s]+israel[\s]+remotely`),
  latinTerm(String.raw`can[\s]+work[\s]+remotely[\s]+from[\s]+israel|remote[\s]+work[\s]+from[\s]+israel`),
  /\bworldwide\s+remote\b.*\bisrael\b/i,
  /\bisrael\b.*\bworldwide\s+remote\b/i,
];

/** Works without an office. Alone this proves nothing about Israel: it needs Israel context or a lookup. */
const REMOTE_GENERIC: readonly RegExp[] = [
  latinTerm(String.raw`remote|wfh|work[\s]+from[\s]+home`),
  hebrewTerm(String.raw`מהבית|מרחוק`),
];

/** Needs an office, so the city must be known. Never counts as "remote". */
const HYBRID: readonly RegExp[] = [latinTerm("hybrid"), hebrewTerm("היברידי")];

export type LocationRulesVerdict = "eligible" | "ineligible" | "needs_lookup";

export type LocationRulesDetail = {
  verdict: LocationRulesVerdict;
  /** Short machine-readable reason, also shown in the sheet Location column. */
  evidence: string;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function combinedText(title: string, snippet: string, url: string): string {
  const titleText = title.replace(/\s+/g, " ").trim();
  const text = `${titleText} ${snippet}`.replace(/\s+/g, " ").trim();
  return normalizeLocationAliases(`${titleText} ${text} ${safeDecode(url)}`.trim());
}

function isForeignOnlySite(title: string, snippet: string, url: string): boolean {
  const titleText = title.replace(/\s+/g, " ").trim();
  if (matchesAny(FOREIGN_LOCATION, titleText) && !matchesAny(ON_SITE_ACCEPTABLE, titleText)) {
    return true;
  }
  const text = combinedText(title, snippet, url);
  if (matchesAny(FOREIGN_LOCATION, text)) {
    return !matchesAny(REMOTE_FROM_ISRAEL, text) && !matchesAny(ON_SITE_ACCEPTABLE, text);
  }
  return false;
}

/** "Sharon" alone matches US towns (Sharon, CT). Require Israel context for Latin "sharon". */
function matchesIsraeliSharonPlaintext(text: string): boolean {
  if (!/\bsharon\b/i.test(text)) {
    return false;
  }
  if (/\bsharon,\s*(ct|ma|pa|nh|vt|usa|u\.s\.)\b/i.test(text)) {
    return false;
  }
  return /\bisrael\b/i.test(text) || /[\u0590-\u05FF]/.test(text);
}

/** Job appears Israeli but rules cannot confirm remote / metro districts / excluded city. */
export function isIsraelLocationUncertain(title: string, snippet: string, url: string): boolean {
  const blob = combinedText(title, snippet, url);
  if (hasIsraelContext(blob, url)) {
    return true;
  }
  try {
    return /comeet\.com/i.test(url) && /location=.*israel/i.test(decodeURIComponent(url));
  } catch {
    return false;
  }
}

/**
 * Blocked-city check on the part of the text that states the job's location.
 * Shared by the rules and by the cache layer, so a freshly blocked city beats any cached "eligible".
 */
export function matchesExcludedLocationHead(
  title: string,
  snippet: string,
  url = "",
  excludedLocations: readonly string[] = getExcludedLocations(),
): boolean {
  const head = `${title} ${snippet.slice(0, EXCLUDED_SCAN_CHARS)} ${safeDecode(url)}`;
  return textMatchesExcludedLocation(head, excludedLocations);
}

export function classifyLocationDetailed(
  title: string,
  snippet: string,
  url = "",
  excludedLocations: readonly string[] = getExcludedLocations(),
): LocationRulesDetail {
  if (matchesExcludedLocationHead(title, snippet, url, excludedLocations)) {
    return { verdict: "ineligible", evidence: "blocked_city" };
  }
  if (isForeignOnlySite(title, snippet, url)) {
    return { verdict: "ineligible", evidence: "foreign_only" };
  }
  const text = combinedText(title, snippet, url);
  const israelRemote = firstMatch(REMOTE_FROM_ISRAEL, text);
  if (israelRemote) {
    return { verdict: "eligible", evidence: `remote_israel:${israelRemote}` };
  }
  const metro = firstMatch(ON_SITE_ACCEPTABLE, text)
    ?? (matchesIsraeliSharonPlaintext(text) ? "sharon" : null);
  if (metro) {
    return { verdict: "eligible", evidence: `metro:${metro}` };
  }
  const remote = firstMatch(REMOTE_GENERIC, text);
  const israelContext = hasIsraelContext(text, url) || matchesAny(OTHER_ISRAEL_REGIONS, text);
  if (remote && israelContext) {
    return { verdict: "eligible", evidence: `remote+israel:${remote}` };
  }
  if (matchesAny(OTHER_ISRAEL_REGIONS, text)) {
    return { verdict: "ineligible", evidence: "other_israel_region" };
  }
  if (remote) {
    return { verdict: "needs_lookup", evidence: "remote_without_israel" };
  }
  if (looksLikeSingleCompanyJobPosting(url)) {
    return { verdict: "needs_lookup", evidence: "company_posting_location_in_body" };
  }
  if (/greenhouse\.io/i.test(url) && /\/jobs\/\d+|embed\/job_app|token=\d+/i.test(url)) {
    return { verdict: "needs_lookup", evidence: "greenhouse_posting_location_in_body" };
  }
  if (isIsraelLocationUncertain(title, snippet, url)) {
    return {
      verdict: "needs_lookup",
      evidence: matchesAny(HYBRID, text) ? "hybrid_without_city" : "israel_without_city",
    };
  }
  return { verdict: "ineligible", evidence: "no_location_signal" };
}

export function classifyLocationRules(
  title: string,
  snippet: string,
  url = "",
  excludedLocations: readonly string[] = getExcludedLocations(),
): LocationRulesVerdict {
  return classifyLocationDetailed(title, snippet, url, excludedLocations).verdict;
}

/** One job on a company careers site — location is usually in the body, not the sheet title. */
function looksLikeSingleCompanyJobPosting(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (/greenhouse\.io/i.test(parsed.hostname)) {
      return false;
    }
    if (!/\/careers\/[^/?#]+/i.test(parsed.pathname)) {
      return false;
    }
    return !/\/careers\/?$/i.test(parsed.pathname.replace(/\/$/, ""));
  } catch {
    return false;
  }
}

export function isDiscoveryLocationEligible(
  title: string,
  snippet: string,
  url = "",
  excludedLocations: readonly string[] = getExcludedLocations(),
): boolean {
  return classifyLocationRules(title, snippet, url, excludedLocations) === "eligible";
}

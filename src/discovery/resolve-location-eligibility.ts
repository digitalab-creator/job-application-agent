import { getExcludedLocations } from "../application/exclude-location.js";
import { log } from "../logging/logger.js";
import {
  classifyLocationDetailed,
  isDiscoveryLocationEligible,
  LOCATION_RULES_VERSION,
  matchesExcludedLocationHead,
  type LocationRulesVerdict,
} from "./location-eligibility.js";
import { factsToSnippet, researchJobLocationWithLlm } from "./location-llm-resolve.js";
import { fetchJobPostingText } from "./location-page-fetch.js";
import {
  getCachedLocationVerdict,
  locationCacheKey,
  setCachedLocationVerdict,
  type CachedLocationVerdict,
  type LocationVerdictSource,
} from "./location-verdict-cache.js";

export type ResolveLocationInput = {
  title: string;
  snippet: string;
  url: string;
};

/** Why a job was judged eligible or not. `reason` is stored in the sheet Location column for auditing. */
export type LocationVerdict = {
  eligible: boolean;
  source: LocationVerdictSource | "blocked_city";
  reason: string;
};

const inflight = new Map<string, Promise<LocationVerdict>>();

/**
 * Location gate with disk cache + in-flight dedupe. Rules first; optional page fetch and LLM web search
 * only when the job looks Israeli but city/remote is unknown.
 */
export async function resolveJobLocationVerdict(input: ResolveLocationInput): Promise<LocationVerdict> {
  // The block list is the one thing that can change without a deploy, so it always beats the cache.
  if (matchesExcludedLocationHead(input.title, input.snippet, input.url)) {
    return { eligible: false, source: "blocked_city", reason: "blocked_city" };
  }

  const key = locationCacheKey(input.url, input.title);
  const cached = usableCachedVerdict(getCachedLocationVerdict(key), input);
  if (cached) {
    log("LOCATION_VERDICT_CACHE_HIT", { key, eligible: cached.eligible, source: cached.source });
    return { eligible: cached.eligible, source: cached.source, reason: cached.reason };
  }

  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }

  const work = resolveUncached(input, key).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, work);
  return work;
}

export async function resolveJobLocationEligible(input: ResolveLocationInput): Promise<boolean> {
  return (await resolveJobLocationVerdict(input)).eligible;
}

/**
 * Cache entries from older rules are ignored (rules/page_fetch verdicts only; LLM research is expensive and
 * independent of the regexes). A cheap "ineligible" made from a thin snippet is re-judged once a rich snippet exists.
 */
function usableCachedVerdict(
  cached: CachedLocationVerdict | null,
  input: ResolveLocationInput,
): CachedLocationVerdict | null {
  if (!cached) {
    return null;
  }
  if (cached.source !== "llm_search" && cached.rulesVersion !== LOCATION_RULES_VERSION) {
    return null;
  }
  const snippetRich = input.snippet.trim().length > 300;
  if (snippetRich && cached.source === "rules" && !cached.eligible) {
    return null;
  }
  return cached;
}

async function resolveUncached(input: ResolveLocationInput, key: string): Promise<LocationVerdict> {
  const excluded = getExcludedLocations();
  const detail = classifyLocationDetailed(input.title, input.snippet, input.url, excluded);
  if (detail.verdict === "eligible") {
    return remember(key, true, "rules", detail.evidence);
  }
  if (detail.verdict === "ineligible") {
    return remember(key, false, "rules", detail.evidence);
  }

  log("LOCATION_LOOKUP_START", { key, url: input.url, title: input.title.slice(0, 80), why: detail.evidence });

  const pageText = await fetchJobPostingText(input.url);
  if (pageText) {
    const mergedSnippet = `${input.snippet} ${pageText}`.trim();
    const afterPage = classifyLocationDetailed(input.title, mergedSnippet, input.url, excluded);
    if (afterPage.verdict === "eligible") {
      return remember(key, true, "page_fetch", afterPage.evidence);
    }
    if (afterPage.verdict === "ineligible") {
      return remember(key, false, "page_fetch", afterPage.evidence);
    }
  }

  const facts = await researchJobLocationWithLlm({
    title: input.title,
    snippet: pageText ? `${input.snippet} ${pageText}` : input.snippet,
    url: input.url,
  });
  const factsText = factsToSnippet(facts);
  const enriched = `${input.snippet} ${factsText}`.trim();
  const eligible = isDiscoveryLocationEligible(input.title, enriched, input.url, excluded);
  const reason = `${eligible ? "llm_ok" : "llm_reject"}:${factsText.slice(0, 100)}`;
  log("LOCATION_LOOKUP_DONE", { key, eligible, facts });
  return remember(key, eligible, "llm_search", reason);
}

function remember(
  key: string,
  eligible: boolean,
  source: LocationVerdictSource,
  reason: string,
): LocationVerdict {
  setCachedLocationVerdict(key, { eligible, source, reason, rulesVersion: LOCATION_RULES_VERSION });
  return { eligible, source, reason };
}

/** Sync helper for tests and n8n-style rough filters. */
export function locationRulesVerdict(input: ResolveLocationInput): LocationRulesVerdict {
  return classifyLocationDetailed(input.title, input.snippet, input.url, getExcludedLocations()).verdict;
}

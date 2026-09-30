import { getExcludedLocations } from "../application/exclude-location.js";
import { log } from "../logging/logger.js";
import {
  classifyLocationRules,
  isDiscoveryLocationEligible,
  type LocationRulesVerdict,
} from "./location-eligibility.js";
import { factsToSnippet, researchJobLocationWithLlm } from "./location-llm-resolve.js";
import { fetchJobPostingText } from "./location-page-fetch.js";
import {
  getCachedLocationVerdict,
  locationCacheKey,
  setCachedLocationVerdict,
  type LocationVerdictSource,
} from "./location-verdict-cache.js";

const inflight = new Map<string, Promise<boolean>>();

export type ResolveLocationInput = {
  title: string;
  snippet: string;
  url: string;
};

/**
 * Location gate with disk cache + in-flight dedupe. Rules first; optional page fetch and LLM web search
 * only when the job looks Israeli but city/remote is unknown.
 */
export async function resolveJobLocationEligible(input: ResolveLocationInput): Promise<boolean> {
  const key = locationCacheKey(input.url, input.title);
  const cached = getCachedLocationVerdict(key);
  const snippetRich = input.snippet.trim().length > 300;
  if (cached && !(snippetRich && cached.source === "rules" && cached.eligible === false)) {
    log("LOCATION_VERDICT_CACHE_HIT", { key, eligible: cached.eligible, source: cached.source });
    return cached.eligible;
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

async function resolveUncached(input: ResolveLocationInput, key: string): Promise<boolean> {
  const excluded = getExcludedLocations();
  const verdict = classifyLocationRules(input.title, input.snippet, input.url, excluded);
  if (verdict === "eligible") {
    return remember(key, true, "rules", "matched_remote_or_metro_district");
  }
  if (verdict === "ineligible") {
    return remember(key, false, "rules", "failed_rules");
  }

  log("LOCATION_LOOKUP_START", { key, url: input.url, title: input.title.slice(0, 80) });

  const pageText = await fetchJobPostingText(input.url);
  if (pageText) {
    const mergedSnippet = `${input.snippet} ${pageText}`.trim();
    if (isDiscoveryLocationEligible(input.title, mergedSnippet, input.url, excluded)) {
      return remember(key, true, "page_fetch", "eligible_after_page_fetch");
    }
    const afterPage = classifyLocationRules(input.title, mergedSnippet, input.url, excluded);
    if (afterPage === "ineligible") {
      return remember(key, false, "page_fetch", "ineligible_after_page_fetch");
    }
  }

  const facts = await researchJobLocationWithLlm({
    title: input.title,
    snippet: pageText ? `${input.snippet} ${pageText}` : input.snippet,
    url: input.url,
  });
  const enriched = `${input.snippet} ${factsToSnippet(facts)}`.trim();
  const eligible = isDiscoveryLocationEligible(input.title, enriched, input.url, excluded);
  const reason = eligible
    ? `llm_research_ok:${factsToSnippet(facts).slice(0, 120)}`
    : `llm_research_reject:${factsToSnippet(facts).slice(0, 120)}`;
  log("LOCATION_LOOKUP_DONE", { key, eligible, facts });
  return remember(key, eligible, "llm_search", reason);
}

function remember(
  key: string,
  eligible: boolean,
  source: LocationVerdictSource,
  reason: string,
): boolean {
  setCachedLocationVerdict(key, { eligible, source, reason });
  return eligible;
}

/** Sync helper for tests and n8n-style rough filters. */
export function locationRulesVerdict(input: ResolveLocationInput): LocationRulesVerdict {
  return classifyLocationRules(input.title, input.snippet, input.url, getExcludedLocations());
}

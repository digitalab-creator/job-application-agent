import { evaluateJobUrlEligibility } from "../application/job-url-eligibility.js";
import { inspectJobUrls } from "../application/link-liveness.js";
import { log } from "../logging/logger.js";
import type { ScoredDiscoveryJob } from "./score-jobs.js";
import { uniqueKeyForUrl } from "./score-jobs.js";

export type DiscoverySupplyFunnel = {
  rawCandidates: number;
  /** Openings that were not already on the sheet (posting-key dedup). */
  freshOpenings: number;
  /** Scored jobs entering supply validation (after fresh filter). */
  unique: number;
  specificUrls: number;
  verifiedOpen: number;
  geographicEligible: number;
  preliminaryRoleFit: number;
  automatableNew: number;
};

export type ValidatedDiscoveryJob = ScoredDiscoveryJob & {
  sheetStatus: "New" | "Manual";
  canonicalUrl?: string;
  verifyEvidence?: string;
};

export function formatDiscoverySupplyFunnel(funnel: DiscoverySupplyFunnel): string {
  return [
    `supply_raw=${funnel.rawCandidates}`,
    `supply_fresh=${funnel.freshOpenings}`,
    `supply_unique=${funnel.unique}`,
    `supply_specific_urls=${funnel.specificUrls}`,
    `supply_verified_open=${funnel.verifiedOpen}`,
    `supply_geo_eligible=${funnel.geographicEligible}`,
    `supply_preliminary_fit=${funnel.preliminaryRoleFit}`,
    `supply_automatable_new=${funnel.automatableNew}`,
  ].join("\n");
}

/**
 * Validate scored openings before sheet write. Never promote hubs or closed postings to Status=New.
 */
export async function validateDiscoverySupply(input: {
  rawOpeningCount: number;
  freshOpeningCount?: number;
  scored: ScoredDiscoveryJob[];
  maxLivenessChecks?: number;
}): Promise<{ funnel: DiscoverySupplyFunnel; jobs: ValidatedDiscoveryJob[] }> {
  const preliminaryRoleFit = input.scored.length;
  const uniqueByKey = new Map<string, ScoredDiscoveryJob>();
  for (const job of input.scored) {
    const key = job.uniqueKey || uniqueKeyForUrl(job.url);
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, job);
    }
  }
  const uniqueJobs = [...uniqueByKey.values()];
  const geographicEligible = uniqueJobs.length;

  const specificJobs: ScoredDiscoveryJob[] = [];
  for (const job of uniqueJobs) {
    const eligibility = evaluateJobUrlEligibility(job.url);
    if (eligibility.specific) {
      specificJobs.push({ ...job, url: eligibility.url });
    }
  }

  const maxChecks = Math.max(1, Math.min(input.maxLivenessChecks ?? 24, specificJobs.length));
  const toVerify = specificJobs.slice(0, maxChecks);
  const verdicts = await inspectJobUrls(
    toVerify.map((job) => ({ url: job.url, role: job.role })),
  );

  const jobs: ValidatedDiscoveryJob[] = [];
  let verifiedOpen = 0;
  let automatableNew = 0;

  for (let i = 0; i < toVerify.length; i += 1) {
    const job = toVerify[i]!;
    const liveness = verdicts[i]!;
    if (liveness.definitelyClosed || liveness.unreachable) {
      log("DISCOVERY_SUPPLY_REJECT", {
        url: job.url,
        reason: liveness.definitelyClosed ? "closed" : "unreachable",
        detail: liveness.reason,
      });
      continue;
    }
    if (!liveness.definitelyActive) {
      log("DISCOVERY_SUPPLY_REJECT", { url: job.url, reason: "not_proven_active", detail: liveness.reason });
      continue;
    }
    verifiedOpen += 1;
    const eligibility = evaluateJobUrlEligibility(liveness.finalUrl || job.url);
    if (!eligibility.specific) {
      continue;
    }
    const canonicalUrl = liveness.finalUrl !== liveness.originalUrl ? liveness.finalUrl : undefined;
    if (eligibility.automatable) {
      automatableNew += 1;
      jobs.push({
        ...job,
        url: canonicalUrl ?? eligibility.url,
        canonicalUrl,
        sheetStatus: "New",
        verifyEvidence: liveness.reason,
      });
    } else if (eligibility.capability === "manual_only") {
      jobs.push({
        ...job,
        url: canonicalUrl ?? eligibility.url,
        canonicalUrl,
        sheetStatus: "Manual",
        verifyEvidence: liveness.reason,
      });
    }
  }

  const funnel: DiscoverySupplyFunnel = {
    rawCandidates: input.rawOpeningCount,
    freshOpenings: input.freshOpeningCount ?? input.scored.length,
    unique: uniqueJobs.length,
    specificUrls: specificJobs.length,
    verifiedOpen,
    geographicEligible,
    preliminaryRoleFit,
    automatableNew,
  };

  log("DISCOVERY_SUPPLY_FUNNEL", funnel);
  return { funnel, jobs };
}

import { marketingShareFromPolicy } from "../config/search-policy.js";
import { getSearchPolicy } from "../config/search-policy-runtime.js";
import { DISCOVERY_SKIP_NEW_MULTIPLIER as DISCOVERY_SKIP_MULTIPLIER } from "../application/daily-quota.js";
import type { ScoredDiscoveryJob } from "./score-jobs.js";
import {
  categoryBatchTargets,
  normalizeTrackerCategory,
  trackerCategoryQueueSide,
  trackerMarketingShareFromCategories,
} from "./tracker-categories.js";

export type QueueSide = "tech" | "marketing" | "other";

/** Sheet Category column — aligned with job tracker analysis. */
export const TECH_SHEET_CATEGORIES = new Set([
  "Applied AI",
  "AI Product",
  "AI Solutions",
  "Growth Engineering",
  "Digital Operations",
  "Marketing Technology",
]);

export const MARKETING_SHEET_CATEGORIES = new Set([
  "Growth Marketing",
  "Performance Marketing Leadership",
  "Analytics & CRO",
  "Product-led Growth",
  "Revenue Systems",
]);

/** Tie-break boost within a category bucket (higher = prefer when scores tie). */
const CATEGORY_DISCOVERY_BOOST = new Map<string, number>([
  ["Performance Marketing Leadership", 3],
  ["Revenue Systems", 2],
  ["Marketing Technology", 3],
  ["Analytics & CRO", 1],
  ["AI Solutions", 1],
  ["Applied AI", 1],
]);

function discoveryBaseMinScore(): number {
  const raw = process.env.DISCOVERY_MIN_MATCH_SCORE?.trim();
  if (raw) {
    const env = Number(raw);
    if (Number.isFinite(env) && env >= 0) {
      return Math.min(100, Math.floor(env));
    }
  }
  return getSearchPolicy().discoveryMinMatchScore;
}
const TECH_HEAVY_MIN_TECH = 85;
const EXCEPTIONAL_TECH = 90;

/** n8n uses the worker safety cap as its maximum batch size; budget decides the real spend. */
export const DAILY_APPLY_BATCH_LIMIT = 20;

/** Default marketing-side share (~65%). Must match tracker-category-weights; n8n drift script reads this literal. */
export const QUEUE_MIX_MARKETING_SHARE_DEFAULT = 0.80;

/** Marketing share of tech+marketing slots (0–1). Env: `QUEUE_MIX_MARKETING_SHARE`. */
export function queueMixMarketingShare(): number {
  const raw = process.env.QUEUE_MIX_MARKETING_SHARE?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return marketingShareFromPolicy(getSearchPolicy());
}

export function dailyApplyMarketingTarget(batchLimit = DAILY_APPLY_BATCH_LIMIT): number {
  const limit = Math.max(0, Math.floor(batchLimit));
  if (limit === 0) {
    return 0;
  }
  return Math.min(limit, Math.round(limit * queueMixMarketingShare()));
}

export function dailyApplyTechTarget(batchLimit = DAILY_APPLY_BATCH_LIMIT): number {
  const limit = Math.max(0, Math.floor(batchLimit));
  return Math.max(0, limit - dailyApplyMarketingTarget(limit));
}

/** Derived at module load from env — used by drift checks and ops dashboards. */
export const DAILY_APPLY_MARKETING_TARGET = dailyApplyMarketingTarget();
export const DAILY_APPLY_TECH_TARGET = dailyApplyTechTarget();

/** Skip board scan when sheet `New` rows exceed this multiple of the apply safety cap. */
export const DISCOVER_SKIP_NEW_MULTIPLIER = DISCOVERY_SKIP_MULTIPLIER;

export type NewQueueStats = {
  tech: number;
  marketing: number;
  total: number;
  techPct: number;
  /** All sheet rows with Status=New (any category). */
  statusNew?: number;
};

export function shouldSkipDiscoveryForQueueDepth(
  statusNew: number | undefined,
  applySafetyCap: number,
): boolean {
  if (typeof statusNew !== "number" || !Number.isFinite(statusNew)) {
    return false;
  }
  return statusNew > DISCOVER_SKIP_NEW_MULTIPLIER * applySafetyCap;
}

export type RebalanceMode = "heavy_tech" | "moderate_tech" | "maintenance";

export type RebalancePolicy = {
  mode: RebalanceMode;
  techPct: number;
  scoringBias: "marketing" | "balanced";
  targetMarketingShareOfBatch: number;
  minTechMatchScore: number;
  exceptionalTechMin: number;
  baseMinScore: number;
};

export function categorySide(category: string): QueueSide {
  const canonical = normalizeTrackerCategory(category);
  const fromTracker = trackerCategoryQueueSide(canonical);
  if (fromTracker === "tech" || fromTracker === "marketing") {
    return fromTracker;
  }
  const c = canonical.trim();
  if (MARKETING_SHEET_CATEGORIES.has(c)) {
    return "marketing";
  }
  if (TECH_SHEET_CATEGORIES.has(c)) {
    return "tech";
  }
  return "other";
}

export function computeNewQueueStats(rows: Array<{ category?: string }>): NewQueueStats {
  let tech = 0;
  let marketing = 0;
  for (const row of rows) {
    const side = categorySide(String(row.category ?? ""));
    if (side === "tech") {
      tech += 1;
    } else if (side === "marketing") {
      marketing += 1;
    }
  }
  const total = tech + marketing;
  const neutralTechPct = (1 - marketingShareFromPolicy(getSearchPolicy())) * 100;
  const techPct = total > 0 ? (tech / total) * 100 : neutralTechPct;
  return { tech, marketing, total, techPct };
}

export function rebalancePolicy(stats: NewQueueStats): RebalancePolicy {
  const techPct = stats.techPct;
  const targetMarketingShareOfBatch = queueMixMarketingShare();
  const baseMinScore = discoveryBaseMinScore();
  if (techPct > 75) {
    return {
      mode: "heavy_tech",
      techPct,
      scoringBias: "marketing",
      targetMarketingShareOfBatch,
      minTechMatchScore: TECH_HEAVY_MIN_TECH,
      exceptionalTechMin: EXCEPTIONAL_TECH,
      baseMinScore,
    };
  }
  if (techPct > 68) {
    return {
      mode: "moderate_tech",
      techPct,
      scoringBias: "marketing",
      targetMarketingShareOfBatch,
      minTechMatchScore: TECH_HEAVY_MIN_TECH,
      exceptionalTechMin: EXCEPTIONAL_TECH,
      baseMinScore,
    };
  }
  return {
    mode: "maintenance",
    techPct,
    scoringBias: "balanced",
    targetMarketingShareOfBatch,
    minTechMatchScore: baseMinScore,
    exceptionalTechMin: EXCEPTIONAL_TECH,
    baseMinScore,
  };
}

/** Score / mix gate only. Location is decided once, in score-jobs.ts via resolveJobLocationVerdict. */
export function passesDiscoveryQuality(job: ScoredDiscoveryJob, policy: RebalancePolicy): boolean {
  if (job.matchScore < policy.baseMinScore) {
    return false;
  }
  const side = categorySide(job.category);
  if (side === "marketing" || side === "other") {
    return job.matchScore >= policy.baseMinScore;
  }
  if (policy.mode === "maintenance") {
    return job.matchScore >= policy.baseMinScore;
  }
  if (job.matchScore >= policy.exceptionalTechMin) {
    return true;
  }
  return job.matchScore >= policy.minTechMatchScore;
}

export function selectApplyDailyBatch<T extends { category?: string }>(
  eligibleRows: T[],
  scoreOf: (row: T) => number,
): { selected: T[]; pickedTech: number; pickedMarketing: number } {
  const byScore = (a: T, b: T) => scoreOf(b) - scoreOf(a);
  const targets = categoryBatchTargets(DAILY_APPLY_BATCH_LIMIT);
  const buckets = new Map<string, T[]>();
  const other: T[] = [];
  for (const row of eligibleRows) {
    const canonical = normalizeTrackerCategory(String(row.category ?? ""));
    if (targets.has(canonical)) {
      const list = buckets.get(canonical) ?? [];
      list.push(row);
      buckets.set(canonical, list);
    } else {
      other.push(row);
    }
  }
  for (const list of buckets.values()) {
    list.sort(byScore);
  }
  other.sort(byScore);

  const selected: T[] = [];
  const seen = new Set<T>();
  for (const [canonical, target] of targets) {
    const list = buckets.get(canonical) ?? [];
    for (const row of list.slice(0, target)) {
      selected.push(row);
      seen.add(row);
    }
  }
  const backfill = [...eligibleRows].filter((row) => !seen.has(row)).sort(byScore);
  for (const row of backfill) {
    if (selected.length >= DAILY_APPLY_BATCH_LIMIT) {
      break;
    }
    seen.add(row);
    selected.push(row);
  }

  selected.sort(byScore);
  const trimmed = selected.slice(0, DAILY_APPLY_BATCH_LIMIT);
  let pickedTechCount = 0;
  let pickedMarketingCount = 0;
  for (const row of trimmed) {
    const side = categorySide(String(row.category ?? ""));
    if (side === "tech") {
      pickedTechCount += 1;
    } else if (side === "marketing") {
      pickedMarketingCount += 1;
    }
  }
  return { selected: trimmed, pickedTech: pickedTechCount, pickedMarketing: pickedMarketingCount };
}

export function selectDiscoveryBatch(
  candidates: ScoredDiscoveryJob[],
  policy: RebalancePolicy,
  limit: number,
): { selected: ScoredDiscoveryJob[]; addedTech: number; addedMarketing: number } {
  const eligible = candidates.filter((job) => passesDiscoveryQuality(job, policy));
  const targets = categoryBatchTargets(limit);
  const buckets = new Map<string, ScoredDiscoveryJob[]>();
  const other: ScoredDiscoveryJob[] = [];
  for (const job of eligible) {
    const canonical = normalizeTrackerCategory(job.category);
    if (targets.has(canonical)) {
      const list = buckets.get(canonical) ?? [];
      list.push(job);
      buckets.set(canonical, list);
    } else {
      other.push(job);
    }
  }
  const sortBucket = (a: ScoredDiscoveryJob, b: ScoredDiscoveryJob) =>
    effectiveCategoryScore(b) - effectiveCategoryScore(a);
  for (const list of buckets.values()) {
    list.sort(sortBucket);
  }
  other.sort((a, b) => b.matchScore - a.matchScore);

  const selected: ScoredDiscoveryJob[] = [];
  const seen = new Set<ScoredDiscoveryJob>();
  for (const [canonical, target] of targets) {
    const list = buckets.get(canonical) ?? [];
    for (const job of list.slice(0, target)) {
      selected.push(job);
      seen.add(job);
    }
  }
  for (const job of other) {
    if (selected.length >= limit) {
      break;
    }
    if (seen.has(job)) {
      continue;
    }
    seen.add(job);
    selected.push(job);
  }
  for (const job of eligible) {
    if (selected.length >= limit) {
      break;
    }
    if (seen.has(job)) {
      continue;
    }
    seen.add(job);
    selected.push(job);
  }
  const trimmed = selected.slice(0, limit);
  let addedMarketing = 0;
  let addedTech = 0;
  for (const job of trimmed) {
    const side = categorySide(job.category);
    if (side === "marketing") {
      addedMarketing += 1;
    } else if (side === "tech") {
      addedTech += 1;
    }
  }
  return { selected: trimmed, addedTech, addedMarketing };
}

export function formatMixReport(input: {
  queue: NewQueueStats;
  policy: RebalancePolicy;
  addedTech: number;
  addedMarketing: number;
}): string {
  const addedTotal = input.addedTech + input.addedMarketing;
  const addedMktPct = addedTotal > 0 ? ((input.addedMarketing / addedTotal) * 100).toFixed(1) : "n/a";
  const addedTechPct = addedTotal > 0 ? ((input.addedTech / addedTotal) * 100).toFixed(1) : "n/a";
  return [
    `mix_policy=${input.policy.mode}`,
    `queue_new_tech_pct=${input.queue.techPct.toFixed(1)}`,
    `queue_new_tech=${input.queue.tech}`,
    `queue_new_mkt=${input.queue.marketing}`,
    `search_policy_version=${getSearchPolicy().version}`,
    `configured_mkt_share=${(queueMixMarketingShare() * 100).toFixed(0)}%`,
    `discovery_min_score=${getSearchPolicy().discoveryMinMatchScore}`,
    `target_mkt_share_batch=${(input.policy.targetMarketingShareOfBatch * 100).toFixed(0)}%`,
    `added_tech=${input.addedTech}`,
    `added_mkt=${input.addedMarketing}`,
    `added_mix_tech_pct=${addedTechPct}`,
    `added_mix_mkt_pct=${addedMktPct}`,
  ].join("\n");
}

function effectiveCategoryScore(job: ScoredDiscoveryJob): number {
  const canonical = normalizeTrackerCategory(job.category);
  const boost = CATEGORY_DISCOVERY_BOOST.get(canonical) ?? 0;
  return job.matchScore + boost;
}

import { DISCOVERY_SKIP_NEW_MULTIPLIER as DISCOVERY_SKIP_MULTIPLIER } from "../application/daily-quota.js";
import type { ScoredDiscoveryJob } from "./score-jobs.js";

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

const MARKETING_PRIORITY = new Map<string, number>([
  ["Growth Marketing", 3],
  ["Performance Marketing Leadership", 3],
  ["Analytics & CRO", 2],
  ["Product-led Growth", 2],
  ["Revenue Systems", 1],
]);

const BASE_MIN_SCORE = 55;
const TECH_HEAVY_MIN_TECH = 85;
const EXCEPTIONAL_TECH = 90;

/** n8n uses the worker safety cap as its maximum batch size; budget decides the real spend. */
export const DAILY_APPLY_BATCH_LIMIT = 20;

/** Default marketing share when `QUEUE_MIX_MARKETING_SHARE` is unset (apply + discovery SSOT). */
export const QUEUE_MIX_MARKETING_SHARE_DEFAULT = 0.5;

/** Marketing share of tech+marketing slots (0–1). Env: `QUEUE_MIX_MARKETING_SHARE`. */
export function queueMixMarketingShare(): number {
  const parsed = Number(process.env.QUEUE_MIX_MARKETING_SHARE ?? String(QUEUE_MIX_MARKETING_SHARE_DEFAULT));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return QUEUE_MIX_MARKETING_SHARE_DEFAULT;
  }
  return parsed;
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
  const c = category.trim();
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
  const neutralTechPct = (1 - queueMixMarketingShare()) * 100;
  const techPct = total > 0 ? (tech / total) * 100 : neutralTechPct;
  return { tech, marketing, total, techPct };
}

export function rebalancePolicy(stats: NewQueueStats): RebalancePolicy {
  const techPct = stats.techPct;
  const targetMarketingShareOfBatch = queueMixMarketingShare();
  if (techPct > 75) {
    return {
      mode: "heavy_tech",
      techPct,
      scoringBias: "marketing",
      targetMarketingShareOfBatch,
      minTechMatchScore: TECH_HEAVY_MIN_TECH,
      exceptionalTechMin: EXCEPTIONAL_TECH,
      baseMinScore: BASE_MIN_SCORE,
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
      baseMinScore: BASE_MIN_SCORE,
    };
  }
  return {
    mode: "maintenance",
    techPct,
    scoringBias: "balanced",
    targetMarketingShareOfBatch,
    minTechMatchScore: BASE_MIN_SCORE,
    exceptionalTechMin: EXCEPTIONAL_TECH,
    baseMinScore: BASE_MIN_SCORE,
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
  const tech = eligibleRows.filter((row) => categorySide(String(row.category ?? "")) === "tech");
  const marketing = eligibleRows.filter((row) => categorySide(String(row.category ?? "")) === "marketing");
  const other = eligibleRows.filter((row) => categorySide(String(row.category ?? "")) === "other");
  const byScore = (a: T, b: T) => scoreOf(b) - scoreOf(a);
  tech.sort(byScore);
  marketing.sort(byScore);
  other.sort(byScore);

  const marketingTarget = dailyApplyMarketingTarget(DAILY_APPLY_BATCH_LIMIT);
  const techTarget = dailyApplyTechTarget(DAILY_APPLY_BATCH_LIMIT);
  const pickedMarketingRows = marketing.slice(0, marketingTarget);
  const pickedTechRows = tech.slice(0, techTarget);
  const selected: T[] = [...pickedMarketingRows, ...pickedTechRows];
  const seen = new Set(selected);

  const backfill = [...tech.slice(techTarget), ...marketing.slice(marketingTarget), ...other].sort(
    byScore,
  );
  for (const row of backfill) {
    if (selected.length >= DAILY_APPLY_BATCH_LIMIT) {
      break;
    }
    if (seen.has(row)) {
      continue;
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
  const marketing = eligible
    .filter((job) => categorySide(job.category) === "marketing")
    .sort((a, b) => effectiveMarketingScore(b) - effectiveMarketingScore(a));
  const tech = eligible
    .filter((job) => categorySide(job.category) === "tech")
    .sort((a, b) => b.matchScore - a.matchScore);
  const other = eligible
    .filter((job) => categorySide(job.category) === "other")
    .sort((a, b) => b.matchScore - a.matchScore);

  const targetMkt = Math.min(marketing.length, Math.round(limit * policy.targetMarketingShareOfBatch));
  const pickedMkt = marketing.slice(0, targetMkt);
  let remaining = limit - pickedMkt.length;
  const pickedTech: ScoredDiscoveryJob[] = [];
  for (const job of tech) {
    if (remaining <= 0) {
      break;
    }
    pickedTech.push(job);
    remaining -= 1;
  }
  for (const job of other) {
    if (remaining <= 0) {
      break;
    }
    pickedTech.push(job);
    remaining -= 1;
  }
  const selected = [...pickedMkt, ...pickedTech];
  const addedMarketing = pickedMkt.length;
  const addedTech = selected.length - addedMarketing;
  return { selected, addedTech, addedMarketing };
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
    `configured_mkt_share=${(queueMixMarketingShare() * 100).toFixed(0)}%`,
    `target_mkt_share_batch=${(input.policy.targetMarketingShareOfBatch * 100).toFixed(0)}%`,
    `added_tech=${input.addedTech}`,
    `added_mkt=${input.addedMarketing}`,
    `added_mix_tech_pct=${addedTechPct}`,
    `added_mix_mkt_pct=${addedMktPct}`,
  ].join("\n");
}

function effectiveMarketingScore(job: ScoredDiscoveryJob): number {
  const boost = MARKETING_PRIORITY.get(job.category) ?? 0;
  return job.matchScore + boost;
}

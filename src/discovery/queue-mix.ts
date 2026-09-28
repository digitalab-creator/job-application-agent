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

export type NewQueueStats = {
  tech: number;
  marketing: number;
  total: number;
  techPct: number;
};

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
  const techPct = total > 0 ? (tech / total) * 100 : 65;
  return { tech, marketing, total, techPct };
}

export function rebalancePolicy(stats: NewQueueStats): RebalancePolicy {
  const techPct = stats.techPct;
  if (techPct > 75) {
    return {
      mode: "heavy_tech",
      techPct,
      scoringBias: "marketing",
      targetMarketingShareOfBatch: 0.6,
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
      targetMarketingShareOfBatch: 0.5,
      minTechMatchScore: TECH_HEAVY_MIN_TECH,
      exceptionalTechMin: EXCEPTIONAL_TECH,
      baseMinScore: BASE_MIN_SCORE,
    };
  }
  return {
    mode: "maintenance",
    techPct,
    scoringBias: "balanced",
    targetMarketingShareOfBatch: 0.35,
    minTechMatchScore: BASE_MIN_SCORE,
    exceptionalTechMin: EXCEPTIONAL_TECH,
    baseMinScore: BASE_MIN_SCORE,
  };
}

export function passesDiscoveryQuality(job: ScoredDiscoveryJob, policy: RebalancePolicy): boolean {
  if (job.matchScore < policy.baseMinScore) {
    return false;
  }
  if (isDispreferredLocation(job.role, job.whyItFits)) {
    return job.matchScore >= policy.exceptionalTechMin;
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

/** Obvious non-IL postings on Comeet — do not relax score floor for ratio. */
function isDispreferredLocation(title: string, snippet: string): boolean {
  const text = `${title} ${snippet}`;
  if (/\b(israel|tel aviv|tel-?aviv|raanana|netanya|hybrid|remote israel)\b/i.test(text)) {
    return false;
  }
  return /\b(austin|mountain view|san francisco|nashville|iceland|warsaw|wrocław|krakow|poland|remote us|united states)\b/i.test(text);
}

import type { Persona } from "../models/types.js";
import { getSearchPolicy } from "../config/search-policy-runtime.js";
import {
  TRACKER_CATEGORY_TARGET_SHARE,
  trackerMarketingShareFromCategoryWeights,
  type CategoryWeightMap,
} from "./tracker-category-weights.js";

export { TRACKER_CATEGORY_TARGET_SHARE, type CategoryWeightMap, CANONICAL_TRACKER_CATEGORIES } from "./tracker-category-weights.js";

const LEGACY_CATEGORY_ALIASES = new Map<string, string>([
  ["Growth Marketing", "Performance Marketing Leadership"],
  ["Product-led Growth", "Performance Marketing Leadership"],
  ["AI Product", "Applied AI"],
  ["Growth Engineering", "Marketing Technology"],
  ["Digital Operations", "Revenue Systems"],
  ["Hybrid", "Marketing Technology"],
]);

/** Coarse queue side for tech-heavy discovery gates (not CV persona). */
export const TRACKER_CATEGORY_QUEUE_SIDE = new Map<string, "tech" | "marketing">([
  ["Performance Marketing Leadership", "marketing"],
  ["Revenue Systems", "marketing"],
  ["Analytics & CRO", "marketing"],
  ["Marketing Technology", "tech"],
  ["AI Solutions", "tech"],
  ["Applied AI", "tech"],
]);

/**
 * Default CV persona when sheet category is set; apply-time job-fit LLM still validates.
 * Revenue Systems / MarTech → hybrid CV (tech headline + growth facts).
 */
export const TRACKER_CATEGORY_CV_PERSONA = new Map<string, Persona>([
  ["Performance Marketing Leadership", "marketing"],
  ["Revenue Systems", "hybrid"],
  ["Marketing Technology", "hybrid"],
  ["AI Solutions", "technical"],
  ["Applied AI", "technical"],
  ["Analytics & CRO", "marketing"],
]);

export function normalizeTrackerCategory(raw: string): string {
  const trimmed = raw.trim();
  if (TRACKER_CATEGORY_TARGET_SHARE.has(trimmed)) {
    return trimmed;
  }
  const alias = LEGACY_CATEGORY_ALIASES.get(trimmed);
  if (alias) {
    return alias;
  }
  return trimmed;
}

/** Sheet Category cell value after migration, or null when already canonical / empty. */
export function trackerCategoryMigrationTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const canonical = normalizeTrackerCategory(trimmed);
  if (canonical === trimmed && TRACKER_CATEGORY_TARGET_SHARE.has(trimmed)) {
    return null;
  }
  if (canonical === trimmed) {
    return null;
  }
  return canonical;
}

export function legacyTrackerCategoryLabels(): string[] {
  return [...LEGACY_CATEGORY_ALIASES.keys()];
}

export function trackerCategoryQueueSide(category: string): "tech" | "marketing" | "other" {
  const canonical = normalizeTrackerCategory(category);
  const side = TRACKER_CATEGORY_QUEUE_SIDE.get(canonical);
  if (side) {
    return side;
  }
  if (/marketing|ppc|performance|cro|analytics/i.test(canonical)) {
    return "marketing";
  }
  if (/ai|engineer|technology|solutions/i.test(canonical)) {
    return "tech";
  }
  return "other";
}

export function suggestedPersonaForTrackerCategory(category: string): Persona | null {
  const canonical = normalizeTrackerCategory(category);
  return TRACKER_CATEGORY_CV_PERSONA.get(canonical) ?? null;
}

/** Integer slot targets per category for a batch of `limit` (largest-remainder). */
export function categoryBatchTargets(limit: number, weights?: CategoryWeightMap): Map<string, number> {
  const safeLimit = Math.max(0, Math.floor(limit));
  const entries = [...(weights ?? getSearchPolicy().categoryWeights).entries()];
  const raw = entries.map(([name, share]) => ({
    name,
    exact: safeLimit * share,
    floor: Math.floor(safeLimit * share),
  }));
  let assigned = raw.reduce((sum, row) => sum + row.floor, 0);
  const remainders = raw
    .map((row) => ({ name: row.name, remainder: row.exact - row.floor }))
    .sort((a, b) => b.remainder - a.remainder);
  const targets = new Map<string, number>();
  for (const row of raw) {
    targets.set(row.name, row.floor);
  }
  let i = 0;
  while (assigned < safeLimit && i < remainders.length) {
    const name = remainders[i]!.name;
    targets.set(name, (targets.get(name) ?? 0) + 1);
    assigned += 1;
    i += 1;
  }
  return targets;
}

/** Marketing share implied by active policy weights (for logs and legacy env default). */
export function trackerMarketingShareFromCategories(): number {
  return trackerMarketingShareFromCategoryWeights(getSearchPolicy().categoryWeights);
}

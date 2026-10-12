/** Marketing Technology describes marketing/revenue execution even when CV is hybrid. */
/** Canonical tracker categories and default allocation (shares sum to 1). SSOT for code defaults; sheet Search Config overrides at runtime. */
export type CategoryWeightMap = Map<string, number>;

export const TRACKER_CATEGORY_TARGET_SHARE: CategoryWeightMap = new Map([
  ["Performance Marketing Leadership", 0.35],
  ["Revenue Systems", 0.25],
  ["Marketing Technology", 0.15],
  ["AI Solutions", 0.1],
  ["Applied AI", 0.1],
  ["Analytics & CRO", 0.05],
]);

export const CANONICAL_TRACKER_CATEGORIES = [...TRACKER_CATEGORY_TARGET_SHARE.keys()];

const QUEUE_SIDE = new Map<string, "tech" | "marketing">([
  ["Performance Marketing Leadership", "marketing"],
  ["Revenue Systems", "marketing"],
  ["Analytics & CRO", "marketing"],
  ["Marketing Technology", "marketing"],
  ["AI Solutions", "tech"],
  ["Applied AI", "tech"],
]);

export function trackerMarketingShareFromCategoryWeights(weights: CategoryWeightMap): number {
  let marketing = 0;
  for (const [name, share] of weights) {
    if (QUEUE_SIDE.get(name) === "marketing") {
      marketing += share;
    }
  }
  return marketing;
}

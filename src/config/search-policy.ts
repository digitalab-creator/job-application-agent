import {
  TRACKER_CATEGORY_TARGET_SHARE,
  type CategoryWeightMap,
} from "../discovery/tracker-category-weights.js";
import { trackerMarketingShareFromCategoryWeights } from "../discovery/tracker-category-weights.js";

export const SEARCH_POLICY_DEFAULT_VERSION = "2026-03-26-targeting-v1";

export type SearchPolicy = {
  version: string;
  discoveryMinMatchScore: number;
  discoverEnabled: boolean;
  /** Skip discovery when Review + Manual rows are at or above this count. */
  skipDiscoverWhenUnresolvedGte: number;
  categoryWeights: CategoryWeightMap;
};

export function defaultSearchPolicy(): SearchPolicy {
  return {
    version: SEARCH_POLICY_DEFAULT_VERSION,
    discoveryMinMatchScore: 70,
    discoverEnabled: true,
    skipDiscoverWhenUnresolvedGte: 100,
    categoryWeights: new Map(TRACKER_CATEGORY_TARGET_SHARE),
  };
}

export function marketingShareFromPolicy(policy: SearchPolicy): number {
  return trackerMarketingShareFromCategoryWeights(policy.categoryWeights);
}

/** Parse `Search Config` tab rows: settings (Key/Value) plus optional Category/Share table. */
export function parseSearchConfigSheet(values: string[][]): SearchPolicy {
  const base = defaultSearchPolicy();
  if (values.length === 0) {
    return base;
  }
  const header = values[0]?.map((cell) => cell.trim()) ?? [];
  const keyCol = header.findIndex((h) => /^key$/i.test(h));
  const valueCol = header.findIndex((h) => /^value$/i.test(h));
  const categoryCol = header.findIndex((h) => /^category$/i.test(h));
  const shareCol = header.findIndex((h) => /^share$/i.test(h) || /^weight$/i.test(h) || /%/.test(h));

  const settings = new Map<string, string>();
  const weights = new Map<string, number>();

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] ?? [];
    if (keyCol >= 0 && valueCol >= 0) {
      const key = String(row[keyCol] ?? "").trim();
      const value = String(row[valueCol] ?? "").trim();
      if (key) {
        settings.set(key.toLowerCase(), value);
      }
    }
    if (categoryCol >= 0 && shareCol >= 0) {
      const category = String(row[categoryCol] ?? "").trim();
      const shareRaw = String(row[shareCol] ?? "").trim().replace(/%$/, "");
      const share = Number(shareRaw);
      if (category && Number.isFinite(share) && share > 0) {
        weights.set(category, share > 1 ? share / 100 : share);
      }
    }
  }

  if (weights.size === 0) {
    for (const [key, value] of settings) {
      if (TRACKER_CATEGORY_TARGET_SHARE.has(key)) {
        const n = Number(value.replace(/%$/, ""));
        if (Number.isFinite(n) && n > 0) {
          weights.set(key, n > 1 ? n / 100 : n);
        }
      }
    }
  }

  const version = settings.get("policy_version") ?? settings.get("policy version") ?? base.version;
  const minScore = parseIntSetting(settings, "discovery_min_match_score", base.discoveryMinMatchScore);
  const discoverEnabled = parseBoolSetting(settings, "discover_enabled", base.discoverEnabled);
  const unresolvedGte = parseIntSetting(
    settings,
    "skip_discover_when_unresolved_gte",
    base.skipDiscoverWhenUnresolvedGte,
  );

  let categoryWeights = weights.size > 0 ? weights : base.categoryWeights;
  categoryWeights = normalizeCategoryWeights(categoryWeights);

  return {
    version,
    discoveryMinMatchScore: clampScore(minScore),
    discoverEnabled,
    skipDiscoverWhenUnresolvedGte: Math.max(0, unresolvedGte),
    categoryWeights,
  };
}

function normalizeCategoryWeights(weights: CategoryWeightMap): CategoryWeightMap {
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return new Map(TRACKER_CATEGORY_TARGET_SHARE);
  }
  if (Math.abs(sum - 1) < 0.02) {
    return weights;
  }
  const out = new Map<string, number>();
  for (const [name, share] of weights) {
    out.set(name, share / sum);
  }
  return out;
}

function parseIntSetting(settings: Map<string, string>, key: string, fallback: number): number {
  const raw = settings.get(key);
  if (!raw) {
    return fallback;
  }
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function parseBoolSetting(settings: Map<string, string>, key: string, fallback: boolean): boolean {
  const raw = settings.get(key)?.toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["false", "0", "no", "off", "disabled"].includes(raw)) {
    return false;
  }
  if (["true", "1", "yes", "on", "enabled"].includes(raw)) {
    return true;
  }
  return fallback;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.floor(score)));
}

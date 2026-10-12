import {
  TRACKER_CATEGORY_TARGET_SHARE,
  type CategoryWeightMap,
} from "../discovery/tracker-category-weights.js";
import { trackerMarketingShareFromCategoryWeights } from "../discovery/tracker-category-weights.js";

export const SEARCH_POLICY_DEFAULT_VERSION = "2026-03-26-targeting-v1";

export type SearchConfigSource = "sheet_key_value" | "sheet_category_table" | "defaults";

export type SearchPolicy = {
  version: string;
  discoveryMinMatchScore: number;
  discoverEnabled: boolean;
  /** Skip discovery when Review + Manual rows are at or above this count. */
  skipDiscoverWhenUnresolvedGte: number;
  categoryWeights: CategoryWeightMap;
  configSource: SearchConfigSource;
  careerFocusMode: "balanced" | "recovery";
  parseWarnings: string[];
};

export function defaultSearchPolicy(): SearchPolicy {
  return {
    version: SEARCH_POLICY_DEFAULT_VERSION,
    discoveryMinMatchScore: 70,
    discoverEnabled: true,
    skipDiscoverWhenUnresolvedGte: 100,
    categoryWeights: new Map(TRACKER_CATEGORY_TARGET_SHARE),
    configSource: "defaults",
    careerFocusMode: "balanced",
    parseWarnings: [],
  };
}

export function marketingShareFromPolicy(policy: SearchPolicy): number {
  return trackerMarketingShareFromCategoryWeights(policy.categoryWeights);
}

function headerIndex(header: string[], patterns: RegExp[]): number {
  return header.findIndex((h) => patterns.some((re) => re.test(h)));
}

/** Parse `Search Config` tab rows: settings (Key/Value) plus optional Category/Share table. */
export function parseSearchConfigSheet(values: string[][]): SearchPolicy {
  const base = defaultSearchPolicy();
  const parseWarnings: string[] = [];
  if (values.length === 0) {
    return { ...base, parseWarnings: ["empty_sheet_using_defaults"] };
  }
  const header = values[0]?.map((cell) => cell.trim()) ?? [];
  let keyCol = headerIndex(header, [/^key$/i]);
  let valueCol = headerIndex(header, [/^value$/i]);
  let categoryCol = headerIndex(header, [/^category$/i, /^search category$/i]);
  let shareCol = headerIndex(header, [/^share$/i, /^weight$/i, /^preference$/i, /%$/i]);
  if (keyCol < 0 && valueCol >= 0 && headerIndex(header, [/^preference$/i]) >= 0) {
    keyCol = headerIndex(header, [/^preference$/i]);
    parseWarnings.push("mapped_preference_column_as_settings_key");
  }
  if (shareCol < 0 && valueCol >= 0 && categoryCol >= 0) {
    shareCol = valueCol;
    parseWarnings.push("mapped_value_column_as_category_share");
  }
  if (keyCol < 0 && valueCol < 0) {
    parseWarnings.push("missing_key_value_columns_using_defaults_for_settings");
  }

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
    if (categoryCol >= 0 && valueCol >= 0) {
      const maybeKey = String(row[categoryCol] ?? "").trim();
      const maybeValue = String(row[valueCol] ?? "").trim();
      if (maybeKey && maybeValue && looksLikeSearchSettingKey(maybeKey)) {
        settings.set(maybeKey.toLowerCase(), maybeValue);
        parseWarnings.push("settings_from_search_category_column");
      }
    }
    if (categoryCol >= 0 && shareCol >= 0) {
      const category = String(row[categoryCol] ?? "").trim();
      if (category && looksLikeSearchSettingKey(category)) {
        continue;
      }
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

  const focusRaw = settings.get("career_focus_mode")?.toLowerCase();
  const careerFocusMode = focusRaw === "recovery" ? "recovery" : "balanced";
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

  const configSource: SearchConfigSource = weights.size > 0
    ? "sheet_category_table"
    : settings.size > 0
      ? "sheet_key_value"
      : "defaults";
  if (configSource === "defaults" && parseWarnings.length === 0) {
    parseWarnings.push("no_recognized_rows_using_defaults");
  }

  return {
    version,
    careerFocusMode,
    discoveryMinMatchScore: clampScore(minScore),
    discoverEnabled,
    skipDiscoverWhenUnresolvedGte: Math.max(0, unresolvedGte),
    categoryWeights,
    configSource,
    parseWarnings: [...new Set(parseWarnings)],
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

function looksLikeSearchSettingKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (/_/.test(normalized)) {
    return true;
  }
  return /^(discover|discovery|policy|skip)/.test(normalized);
}

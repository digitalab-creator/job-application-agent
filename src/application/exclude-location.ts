import fs from "node:fs";
import path from "node:path";
import { log } from "../logging/logger.js";

/**
 * Cities we never auto-apply to (matched in title, URL, and the top of the page text).
 *
 * SINGLE SOURCE OF TRUTH: data/config/excluded-locations.json (mounted at /app/data/config).
 * Edit that file, or `PUT /config/excluded-locations`. There is deliberately no code seed,
 * no env fallback and no sheet copy: two lists would drift apart.
 */
export type ExcludedLocationsConfig = {
  locations: string[];
  updatedAt?: string;
  source?: string;
};

/** Job location is stated near the top; footers list every company office, so scanning all of it blocks good jobs. */
export const EXCLUDED_SCAN_CHARS = 2_500;

export function parseExcludedLocationsText(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || "").split(/[\n,;]+/)) {
    const location = part.trim();
    if (!location) {
      continue;
    }
    const key = normalizeLocationKey(location);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(location);
  }
  return out;
}

export function normalizeLocationKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s_\-./]+/g, "")
    .replace(/[''"]/g, "");
}

export function excludedLocationsPath(): string {
  const fromEnv = process.env.APPLY_EXCLUDED_LOCATIONS_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return "/app/data/config/excluded-locations.json";
}

let cached: { filePath: string; mtimeMs: number; list: string[] } | null = null;

/**
 * Reads the block list from its one file. A missing or unreadable file is logged loudly, never silently ignored.
 * Re-reads only when the file's mtime changes, so edits apply immediately without a disk read per classification.
 */
export function getExcludedLocations(): string[] {
  const filePath = excludedLocationsPath();
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    cached = null;
    log("EXCLUDED_LOCATIONS_FILE_MISSING", { filePath, effect: "no cities are blocked" });
    return [];
  }
  if (cached && cached.filePath === filePath && cached.mtimeMs === mtimeMs) {
    return cached.list;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ExcludedLocationsConfig | string[];
    const list = Array.isArray(raw) ? raw : raw.locations;
    if (Array.isArray(list)) {
      const normalized = normalizeLocationList(list.map(String));
      cached = { filePath, mtimeMs, list: normalized };
      return normalized;
    }
    log("EXCLUDED_LOCATIONS_FILE_INVALID", { filePath, reason: "no locations array" });
  } catch (error) {
    log("EXCLUDED_LOCATIONS_FILE_INVALID", {
      filePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return [];
}

export function setExcludedLocations(
  locations: string[],
  source = "api",
): ExcludedLocationsConfig {
  const normalized = normalizeLocationList(locations);
  const payload: ExcludedLocationsConfig = {
    locations: normalized,
    updatedAt: new Date().toISOString(),
    source,
  };
  const filePath = excludedLocationsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  cached = null;
  return payload;
}

/** Startup check: report what is blocked (or shout that nothing is). Never invents a list. */
export function ensureExcludedLocationsConfig(): ExcludedLocationsConfig {
  const locations = getExcludedLocations();
  log("EXCLUDED_LOCATIONS_LOADED", { count: locations.length, filePath: excludedLocationsPath() });
  return { locations };
}

export function findExcludedLocationMatch(
  text: string,
  excluded: readonly string[] = getExcludedLocations(),
): string | null {
  const blob = String(text || "").normalize("NFKC");
  if (!blob.trim()) {
    return null;
  }
  for (const item of excluded) {
    const needle = String(item || "").trim();
    if (!needle) {
      continue;
    }
    if (locationNeedleMatchesText(needle, blob)) {
      return needle;
    }
  }
  return null;
}

export function textMatchesExcludedLocation(
  text: string,
  excluded: readonly string[] = getExcludedLocations(),
): boolean {
  return findExcludedLocationMatch(text, excluded) !== null;
}

/** Match whole location tokens — avoid substring hits inside unrelated words. */
export function locationNeedleMatchesText(needle: string, blob: string): boolean {
  const trimmed = needle.trim();
  if (!trimmed) {
    return false;
  }
  if (/[\u0590-\u05FF]/.test(trimmed)) {
    return blob.includes(trimmed);
  }
  const strippedBlob = blob.replace(/[''´`]/g, "");
  const strippedNeedle = trimmed.replace(/[''´`]/g, "");
  const escaped = strippedNeedle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/\w/.test(strippedNeedle)) {
    return new RegExp(`\\b${escaped}\\b`, "i").test(strippedBlob);
  }
  return blob.includes(trimmed);
}

function normalizeLocationList(locations: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const location of locations) {
    const trimmed = String(location || "").trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizeLocationKey(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

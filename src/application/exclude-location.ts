import fs from "node:fs";
import path from "node:path";

/**
 * Location tokens we never auto-apply to (matched in title, snippet, URL, or page text).
 * Admin SSOT = Google Sheet tab "Exclude Locations" (synced by n8n each apply run).
 */
export type ExcludedLocationsConfig = {
  locations: string[];
  updatedAt?: string;
  source?: string;
};

const DEFAULT_SEED = [
  "רעננה",
  "Ra'anana",
  "Raanana",
  "רחובות",
  "Rehovot",
  "נס ציונה",
  "Nes Ziona",
  "Nes-Ziona",
  "חולון",
  "Holon",
];

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

export function getExcludedLocations(): string[] {
  const filePath = excludedLocationsPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ExcludedLocationsConfig | string[];
      const list = Array.isArray(raw) ? raw : raw.locations;
      if (Array.isArray(list)) {
        return normalizeLocationList(list.map(String));
      }
    }
  } catch {
    // Fall through to env / seed.
  }
  const fromEnv = process.env.APPLY_EXCLUDED_LOCATIONS?.trim();
  if (fromEnv) {
    return parseExcludedLocationsText(fromEnv);
  }
  return [...DEFAULT_SEED];
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
  return payload;
}

export function ensureExcludedLocationsConfig(): ExcludedLocationsConfig {
  const filePath = excludedLocationsPath();
  if (fs.existsSync(filePath)) {
    return {
      locations: getExcludedLocations(),
      updatedAt: undefined,
      source: "file",
    };
  }
  const fromEnv = process.env.APPLY_EXCLUDED_LOCATIONS?.trim();
  const seed = fromEnv ? parseExcludedLocationsText(fromEnv) : [...DEFAULT_SEED];
  return setExcludedLocations(seed, fromEnv ? "env" : "seed");
}

export function textMatchesExcludedLocation(
  text: string,
  excluded: readonly string[] = getExcludedLocations(),
): boolean {
  const blob = String(text || "").normalize("NFKC");
  if (!blob.trim()) {
    return false;
  }
  for (const item of excluded) {
    const needle = String(item || "").trim();
    if (!needle) {
      continue;
    }
    if (locationNeedleMatchesText(needle, blob)) {
      return true;
    }
  }
  return false;
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

import fs from "node:fs";
import path from "node:path";
import { uniqueKeyForUrl } from "./job-url-key.js";

export type LocationVerdictSource = "rules" | "page_fetch" | "llm_search";

export type CachedLocationVerdict = {
  eligible: boolean;
  reason: string;
  source: LocationVerdictSource;
  cachedAt: string;
  /** LOCATION_RULES_VERSION that produced a rules / page_fetch verdict. Missing = made by the pre-versioning rules. */
  rulesVersion?: number;
};

type CacheFile = Record<string, CachedLocationVerdict>;

export function locationVerdictCachePath(): string {
  const fromEnv = process.env.LOCATION_VERDICT_CACHE_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return "/app/data/cache/location-verdicts.json";
}

function readAll(): CacheFile {
  const filePath = locationVerdictCachePath();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as CacheFile;
    }
  } catch {
    // Treat corrupt cache as empty.
  }
  return {};
}

function writeAll(data: CacheFile): void {
  const filePath = locationVerdictCachePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function locationCacheKey(url: string, title = ""): string {
  const fromUrl = uniqueKeyForUrl(url);
  if (fromUrl && fromUrl !== url.toLowerCase() && fromUrl.length > 3) {
    return fromUrl;
  }
  return `title:${title.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120)}`;
}

export function getCachedLocationVerdict(key: string): CachedLocationVerdict | null {
  const entry = readAll()[key];
  if (!entry || typeof entry.eligible !== "boolean") {
    return null;
  }
  return entry;
}

export function setCachedLocationVerdict(
  key: string,
  verdict: Omit<CachedLocationVerdict, "cachedAt">,
): CachedLocationVerdict {
  const all = readAll();
  const payload: CachedLocationVerdict = {
    ...verdict,
    cachedAt: new Date().toISOString(),
  };
  all[key] = payload;
  writeAll(all);
  return payload;
}

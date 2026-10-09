import { greenhousePostingGone } from "./posting-gone.js";

const DEFAULT_PER_URL = 2;
const DEFAULT_MAX_ERROR_SIGNALS = 4;

export function greenhouseNavAttemptsPerUrl(): number {
  const parsed = Number(process.env.GREENHOUSE_NAV_ATTEMPTS_PER_URL ?? String(DEFAULT_PER_URL));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PER_URL;
  }
  return Math.min(5, Math.floor(parsed));
}

export function greenhouseNavMaxErrorSignals(): number {
  const parsed = Number(process.env.GREENHOUSE_NAV_MAX_ERROR_SIGNALS ?? String(DEFAULT_MAX_ERROR_SIGNALS));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_ERROR_SIGNALS;
  }
  return Math.min(12, Math.floor(parsed));
}

const removedCache = new Map<string, boolean>();

/** Skip navigation targets for Greenhouse postings the API already marked 404. */
export async function shouldSkipGreenhouseTarget(url: string): Promise<boolean> {
  if (!/greenhouse\.io/i.test(url)) {
    return false;
  }
  if (removedCache.has(url)) {
    return removedCache.get(url) === true;
  }
  const gone = await greenhousePostingGone(url);
  removedCache.set(url, gone);
  return gone;
}

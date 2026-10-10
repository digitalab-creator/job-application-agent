import { greenhouseJobId } from "../application/openings.js";

/**
 * Stable cache key for a job posting URL (pathname, no trailing slash).
 * Company-site Greenhouse links keep the job id (`?gh_jid=`) because many postings share one path.
 */
export function uniqueKeyForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/$/, "").toLowerCase();
    const ghJid = greenhouseJobId(parsed);
    const base = `${host}${path}`;
    return ghJid ? `${base}?gh_jid=${ghJid}` : base;
  } catch {
    return url.toLowerCase();
  }
}

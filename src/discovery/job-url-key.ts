/** Stable cache key for a job posting URL (pathname, no trailing slash). */
export function uniqueKeyForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Normalize job URLs before Playwright navigation.
 * WordPress VIP career pages often redirect-loop without a trailing slash before the query string.
 */
export function normalizeJobNavigationUrl(url: string): string {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (/\/careers\/[^/]+$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname}/`;
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function navigationRetryUrls(url: string): string[] {
  const normalized = normalizeJobNavigationUrl(url);
  return [...new Set([url.trim(), normalized].filter(Boolean))];
}

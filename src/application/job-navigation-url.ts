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

/** Company career pages often hide the Greenhouse form. Open the board posting when gh_jid is present. */
/** Wix and similar portals: open Greenhouse when the careers SPA stays on a job list. */
export function directGreenhouseUrlsForCareersUrl(url: string): string[] {
  const wix = url.match(/careers\.wix\.com(?:\/.*)?\/positions\/(\d+)/i);
  if (wix?.[1]) {
    const id = wix[1];
    return [
      `https://job-boards.greenhouse.io/embed/job_app?for=wix&token=${id}`,
      `https://job-boards.greenhouse.io/wix/jobs/${id}`,
      `https://boards.greenhouse.io/wix/jobs/${id}`,
    ];
  }
  return [];
}

export function greenhouseBoardUrls(url: string): string[] {
  try {
    const parsed = new URL(url);
    const jid = parsed.searchParams.get("gh_jid");
    if (!jid || !/^\d+$/.test(jid)) {
      return [];
    }
    if (/greenhouse\.io$/i.test(parsed.hostname) || parsed.hostname.endsWith(".greenhouse.io")) {
      return [];
    }
    const slug = parsed.hostname.replace(/^www\./i, "").split(".")[0]?.toLowerCase() ?? "";
    if (!slug || slug.length < 2) {
      return [];
    }
    return [
      `https://job-boards.greenhouse.io/embed/job_app?for=${slug}&token=${jid}`,
      `https://job-boards.greenhouse.io/${slug}/jobs/${jid}`,
      `https://boards.greenhouse.io/${slug}/jobs/${jid}`,
    ];
  } catch {
    return [];
  }
}

export function navigationRetryUrls(url: string): string[] {
  const normalized = normalizeJobNavigationUrl(url);
  const greenhouse = greenhouseBoardUrls(url);
  const directBoard = directGreenhouseUrlsForCareersUrl(url);
  return [...new Set([...greenhouse, url.trim(), normalized, ...directBoard].filter(Boolean))];
}

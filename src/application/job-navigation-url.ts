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
  // `/location/tel-aviv/3789810` is a location hub id, not a Greenhouse posting token — only `/positions/{id}` counts.
  const wixPosition = url.match(/careers\.wix\.com(?:\/.*)?\/positions\/(\d+)/i);
  const id = wixPosition?.[1];
  if (id) {
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
    return greenhousePostUrlsForBoard(slug, jid);
  } catch {
    return [];
  }
}

/** Direct Greenhouse posting URLs (embed first). Avoid boards.greenhouse.io — many boards redirect to marketing careers hubs. */
export function greenhousePostUrlsForBoard(slug: string, jobId: string, eu = false): string[] {
  const host = eu ? "job-boards.eu.greenhouse.io" : "job-boards.greenhouse.io";
  return [
    `https://${host}/embed/job_app?for=${slug}&token=${jobId}`,
    `https://${host}/${slug}/jobs/${jobId}`,
  ];
}

/** Parse slug + job id from Greenhouse board URLs, embed tokens, and legacy boards links. */
export function greenhouseJobPostUrls(url: string): string[] {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const eu = host.includes(".eu.greenhouse.io") || host === "job-boards.eu.greenhouse.io";
    let slug: string | null = null;
    let jobId: string | null = null;

    const token = parsed.searchParams.get("token");
    const forParam = parsed.searchParams.get("for");
    if (token && /^\d+$/.test(token) && forParam) {
      slug = forParam.toLowerCase();
      jobId = token;
      return greenhousePostUrlsForBoard(slug, jobId, eu);
    }

    const pathMatch = parsed.pathname.match(/\/([^/]+)\/jobs\/(\d+)/i);
    if (pathMatch?.[1] && pathMatch[2]) {
      slug = pathMatch[1].toLowerCase();
      jobId = pathMatch[2];
      if (slug === "embed" || slug === "jobs") {
        slug = null;
        jobId = null;
      } else {
        return greenhousePostUrlsForBoard(slug, jobId, eu || /eu\.greenhouse/i.test(host));
      }
    }

    const jid = parsed.searchParams.get("gh_jid");
    if (jid && /^\d+$/.test(jid) && forParam) {
      return greenhousePostUrlsForBoard(forParam.toLowerCase(), jid, eu);
    }

    return [];
  } catch {
    return [];
  }
}

export function navigationRetryUrls(url: string): string[] {
  const normalized = normalizeJobNavigationUrl(url);
  const fromPost = greenhouseJobPostUrls(url);
  const greenhouse = greenhouseBoardUrls(url);
  const directBoard = directGreenhouseUrlsForCareersUrl(url);
  const raw = url.trim();
  const preferEmbedFirst = fromPost.length > 0 || greenhouse.length > 0 || directBoard.length > 0;
  const legacyBoard = preferEmbedFirst && /^https:\/\/boards\.greenhouse\.io\//i.test(raw)
    ? []
    : [raw, normalized];
  return [...new Set([...fromPost, ...greenhouse, ...directBoard, ...legacyBoard].filter(Boolean))];
}

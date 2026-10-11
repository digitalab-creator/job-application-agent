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
/** Greenhouse board slug from embed `for=`, `/slug`, or `/embed/job_board?for=`. */
export function greenhouseBoardSlug(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/greenhouse\.io/i.test(parsed.hostname)) {
      return null;
    }
    const forParam = parsed.searchParams.get("for")?.trim().toLowerCase() ?? "";
    if (forParam && /^[a-z0-9][a-z0-9_-]*$/i.test(forParam)) {
      return forParam;
    }
    const segment = parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    if (segment && !/^(embed|jobs)$/i.test(segment)) {
      return segment;
    }
  } catch {
    return null;
  }
  return null;
}

/** Broken embed board links (error=true) — recover via the public Greenhouse board listing. */
export function greenhouseJobBoardRecoveryUrls(url: string): string[] {
  try {
    const parsed = new URL(url);
    if (!/greenhouse\.io/i.test(parsed.hostname)) {
      return [];
    }
    const slug = parsed.searchParams.get("for")?.trim().toLowerCase() ?? "";
    if (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
      return [];
    }
    const brokenBoard =
      /\/embed\/job_board\b/i.test(parsed.pathname) ||
      parsed.searchParams.get("error") === "true";
    if (!brokenBoard) {
      return [];
    }
    const eu = parsed.hostname.includes(".eu.greenhouse.io");
    const host = eu ? "job-boards.eu.greenhouse.io" : "job-boards.greenhouse.io";
    return [
      `https://${host}/${slug}`,
      `https://boards.greenhouse.io/${slug}`,
    ];
  } catch {
    return [];
  }
}

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
  const boardRecovery = greenhouseJobBoardRecoveryUrls(url);
  const raw = url.trim();
  const preferEmbedFirst =
    fromPost.length > 0 || greenhouse.length > 0 || directBoard.length > 0 || boardRecovery.length > 0;
  const skipLegacyRaw =
    boardRecovery.length > 0 ||
    (preferEmbedFirst && /^https:\/\/boards\.greenhouse\.io\//i.test(raw));
  const legacyBoard = skipLegacyRaw ? [] : [raw, normalized];
  return [...new Set([...fromPost, ...greenhouse, ...directBoard, ...boardRecovery, ...legacyBoard].filter(Boolean))];
}

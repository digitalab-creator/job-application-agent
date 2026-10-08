export type ListedJob = {
  title: string;
  href: string;
  snippet: string;
};

/** Keep real job links on the same board. Drop the board itself, duplicates, and empty slugs. */
export function normalizeOpenings(
  raw: Array<{ title: string; href: string; snippet: string }>,
  pageUrl: string,
): ListedJob[] {
  const page = safeUrl(pageUrl);
  const seen = new Set<string>();
  const jobs: ListedJob[] = [];
  for (const item of raw) {
    const target = safeUrl(item.href);
    if (!page || !target) {
      continue;
    }
    if (target.origin !== page.origin) {
      continue;
    }
    const path = target.pathname.replace(/\/$/, "");
    const here = page.pathname.replace(/\/$/, "");
    // Greenhouse-on-company-site links (e.g. /job-description/?gh_jid=123): the job id lives in the query string.
    const ghJid = greenhouseJobId(target);
    if (ghJid) {
      if (ghJid === greenhouseJobId(page)) {
        continue;
      }
    } else {
      if (path === here) {
        continue;
      }
      // Drop board/root links when we are already on a deeper posting (Comeet, etc.).
      if (here.startsWith(`${path}/`)) {
        continue;
      }
      const hasPositionQuery = Boolean(jobIdentifierQuery(target));
      const looksLikeJobPath =
        /\/jobs?\/|\/j\/|\/positions\//i.test(path)
        || /\/career\/.+/i.test(path)
        || /\/careers\/position-\d+$/i.test(path)
        || isCompanyGreenhousePostingPath(path)
        || /\/jobslobby\/.+\/\d+$/i.test(path);
      if (!looksLikeJobPath && !hasPositionQuery && !looksLikeOpeningTitle(item.title)) {
        continue;
      }
    }
    // Wix location hubs like /location/tel-aviv/4687 are not job postings.
    if (/careers\.wix\.com/i.test(target.hostname) && /\/location\/[^/]+\/\d+$/i.test(path) && !/\/positions\//i.test(path)) {
      continue;
    }
    // Wix careers chrome (team pages, hiring info) — not open roles.
    if (/careers\.wix\.com/i.test(target.hostname) && isWixCareersNavPath(path)) {
      continue;
    }
    const segments = path.split("/").filter(Boolean);
    const lastSegment = segments.at(-1) ?? "";
    const rawSlug = /^\d+$/.test(lastSegment)
      ? (segments.at(-2) ?? lastSegment)
      : (segments.at(-2) ?? lastSegment);
    const slug = rawSlug.toLowerCase();
    if (!ghJid && (!slug || slug === "none" || slug === "---" || slug === "-")) {
      continue;
    }
    if (!ghJid && slug === "positions" && !/^\d+$/.test(lastSegment)) {
      continue;
    }
    // Same path + different gh_jid are different jobs, so the id is part of the identity.
    const jobQuery = jobIdentifierQuery(target);
    const identity = ghJid ? `${path}?gh_jid=${ghJid}` : `${path}${jobQuery}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    jobs.push({
      title: cleanTitle(item.title, rawSlug),
      // gh_jid links keep their original pathname (trailing slash) because WordPress sites redirect-loop without it.
      href: ghJid
        ? `${target.origin}${target.pathname}?gh_jid=${ghJid}`
        : `${target.origin}${path}${jobQuery}`,
      snippet: item.snippet.replace(/\s+/g, " ").trim().slice(0, 240),
    });
    if (jobs.length >= 40) {
      break;
    }
  }
  return jobs;
}

/** Company-hosted Greenhouse posting page, e.g. `/careers/gid-7633905` (Yotpo). */
export function isCompanyGreenhousePostingPath(path: string): boolean {
  return /\/careers\/gid-\d+\/?$/i.test(path);
}

/** Numeric Greenhouse job id from `?gh_jid=`, or null. */
export function greenhouseJobId(url: URL): string | null {
  const jid = url.searchParams.get("gh_jid");
  return jid && /^\d+$/.test(jid) ? jid : null;
}

export function careersPositionId(url: string): string | null {
  const match = url.match(/\/positions\/(\d+)/i)
    ?? url.match(/\/jobs\/(\d+)/i)
    ?? url.match(/\/position-(\d+)/i);
  const id = match?.[1];
  if (id && /^\d+$/.test(id)) {
    return id;
  }
  try {
    const queryId = new URL(url).searchParams.get("positionId");
    return queryId && /^\d+$/.test(queryId) ? queryId : null;
  } catch {
    return null;
  }
}

export function openingMatchesPositionId(job: ListedJob, positionId: string): boolean {
  try {
    const parsed = new URL(job.href);
    if (parsed.searchParams.get("positionId") === positionId) {
      return true;
    }
    return new RegExp(String.raw`/positions/${positionId}(?:/|$)|/jobs/${positionId}(?:/|$)|/position-${positionId}(?:/|$)`, "i")
      .test(parsed.pathname);
  } catch {
    return false;
  }
}

function jobIdentifierQuery(url: URL): string {
  for (const key of ["positionId", "jobId", "jobNum", "num"]) {
    const value = url.searchParams.get(key);
    if (value && /^\d+$/.test(value)) {
      return `?${key}=${value}`;
    }
  }
  return "";
}

function cleanTitle(title: string, slug: string): string {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned.length >= 4 && cleaned.length <= 120 && !/^(apply|comeet|view|learn more)$/i.test(cleaned)) {
    return cleaned;
  }
  return slug.replace(/--+/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeOpeningTitle(title: string): boolean {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned.length < 6 || cleaned.length > 120) {
    return false;
  }
  if (/^(about|careers?|contact|home|privacy|terms|search|login|sign in|subscribe|learn more|view all jobs?)$/i.test(cleaned)) {
    return false;
  }
  return /engineer|developer|architect|manager|director|lead|analyst|scientist|designer|marketing|growth|product|data|operations|specialist|consultant|recruit|sales|ai\b|backend|frontend|full[- ]?stack/i.test(cleaned)
    || /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,5}\b/.test(cleaned);
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Site nav on careers.wix.com; titles often contain "Engineer" and poison listing + location gates. */
export function isWixCareersNavPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "");
  return /\/team\/|\/teams$|\/early-talent|\/wix-way|\/how-we-hire/i.test(path);
}

export function isWixLocationJobListPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /careers\.wix\.com/i.test(parsed.hostname) && /\/location\/[^/]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function hasWixPositionJobLinks(jobs: ListedJob[]): boolean {
  return jobs.some((job) => /\/positions\/\d+/i.test(job.href));
}

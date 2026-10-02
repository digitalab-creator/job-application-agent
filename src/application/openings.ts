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
      if (!/\/jobs\/|\/job\/|\/j\/|\/positions\//i.test(path)) {
        continue;
      }
    }
    // Wix location hubs like /location/tel-aviv/4687 are not job postings.
    if (/careers\.wix\.com/i.test(target.hostname) && /\/location\/[^/]+\/\d+$/i.test(path) && !/\/positions\//i.test(path)) {
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
    const identity = ghJid ? `${path}?gh_jid=${ghJid}` : path;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    jobs.push({
      title: cleanTitle(item.title, rawSlug),
      // gh_jid links keep their original pathname (trailing slash) because WordPress sites redirect-loop without it.
      href: ghJid ? `${target.origin}${target.pathname}?gh_jid=${ghJid}` : `${target.origin}${path}`,
      snippet: item.snippet.replace(/\s+/g, " ").trim().slice(0, 240),
    });
    if (jobs.length >= 40) {
      break;
    }
  }
  return jobs;
}

/** Numeric Greenhouse job id from `?gh_jid=`, or null. */
export function greenhouseJobId(url: URL): string | null {
  const jid = url.searchParams.get("gh_jid");
  return jid && /^\d+$/.test(jid) ? jid : null;
}

function cleanTitle(title: string, slug: string): string {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned.length >= 4 && cleaned.length <= 120 && !/^(apply|comeet|view|learn more)$/i.test(cleaned)) {
    return cleaned;
  }
  return slug.replace(/--+/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

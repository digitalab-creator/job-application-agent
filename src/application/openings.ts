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
    if (!slug || slug === "none" || slug === "---" || slug === "-") {
      continue;
    }
    if (slug === "positions" && !/^\d+$/.test(lastSegment)) {
      continue;
    }
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    jobs.push({
      title: cleanTitle(item.title, rawSlug),
      href: `${target.origin}${path}`,
      snippet: item.snippet.replace(/\s+/g, " ").trim().slice(0, 240),
    });
    if (jobs.length >= 40) {
      break;
    }
  }
  return jobs;
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

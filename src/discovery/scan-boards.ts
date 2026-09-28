import { normalizeOpenings } from "../application/openings.js";

export type RawBoardJob = {
  title: string;
  href: string;
  snippet: string;
};

export async function fetchBoardJobs(boardUrl: string): Promise<RawBoardJob[]> {
  const response = await fetch(boardUrl, {
    headers: {
      "User-Agent": "JobApplicationAgent/0.1 (+https://digitalab.co.il)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    throw new Error(`Board fetch failed HTTP ${response.status} for ${boardUrl}`);
  }
  const html = await response.text();
  return extractJobLinks(html, boardUrl);
}

export function extractJobLinks(html: string, boardUrl: string): RawBoardJob[] {
  const raw: RawBoardJob[] = [];
  const anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = anchorRe.exec(html);
  while (match) {
    const href = decodeHtml(match[1]);
    const title = stripTags(match[2]);
    if (!href || !title) {
      match = anchorRe.exec(html);
      continue;
    }
    const absolute = toAbsoluteUrl(href, boardUrl);
    if (!absolute) {
      match = anchorRe.exec(html);
      continue;
    }
    raw.push({ title, href: absolute, snippet: title });
    match = anchorRe.exec(html);
  }
  return normalizeOpenings(raw, boardUrl).map((job) => ({
    title: job.title,
    href: job.href,
    snippet: job.snippet,
  }));
}

function toAbsoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

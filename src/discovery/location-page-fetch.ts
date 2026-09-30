import { log } from "../logging/logger.js";

const MAX_CHARS = 12_000;

/** Best-effort plain text from a public job URL (no browser). */
export async function fetchJobPostingText(url: string): Promise<string> {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) {
    return "";
  }
  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "JobApplicationAgent/0.1 (+https://digitalab.co.il)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!response.ok) {
      log("LOCATION_PAGE_FETCH_FAILED", { url: target, status: response.status });
      return "";
    }
    const html = await response.text();
    return htmlToText(html).slice(0, MAX_CHARS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("LOCATION_PAGE_FETCH_FAILED", { url: target, message });
    return "";
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

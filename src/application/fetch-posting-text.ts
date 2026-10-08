import { log } from "../logging/logger.js";
import { greenhouseBoardUrls, greenhouseJobPostUrls } from "./job-navigation-url.js";
import { greenhouseTarget, type GreenhouseTarget } from "./posting-gone.js";

const PREFETCH_TIMEOUT_MS = 20_000;

/**
 * Cheap HTTP fetch of job text for fit preflight — avoids launching the browser when the gate would skip.
 * Returns null when the ATS is unknown or the page did not expose enough text.
 */
export async function fetchPostingTextForFit(url: string): Promise<string | null> {
  if (/comeet\.com\/jobs\//i.test(url)) {
    return fetchComeetPostingText(url);
  }
  const greenhouse = await fetchGreenhousePostingText(url);
  if (greenhouse) {
    return greenhouse;
  }
  return null;
}

async function fetchComeetPostingText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "job-application-agent/1.0", Accept: "text/html" },
      signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const text = extractComeetEmbeddedText(html);
    if (text.length < 120) {
      log("POSTING_PREFETCH_THIN", { url, chars: text.length });
      return null;
    }
    log("POSTING_PREFETCH_OK", { url, chars: text.length, ats: "comeet" });
    return text;
  } catch (error) {
    log("POSTING_PREFETCH_FAILED", {
      url,
      message: error instanceof Error ? error.message : "prefetch_failed",
    });
    return null;
  }
}

/** Full JD from Greenhouse boards API (company-site gh_jid links and board URLs). */
async function fetchGreenhousePostingText(url: string): Promise<string | null> {
  const target = resolveGreenhouseApiTarget(url);
  if (!target) {
    return null;
  }
  const hosts = target.apiHost === "boards-api.eu.greenhouse.io"
    ? [target.apiHost]
    : [target.apiHost, "boards-api.eu.greenhouse.io"];
  for (const apiHost of hosts) {
    const apiUrl = `https://${apiHost}/v1/boards/${target.slug}/jobs/${target.jobId}`;
    try {
      const response = await fetch(apiUrl, {
        headers: { "User-Agent": "job-application-agent/1.0", Accept: "application/json" },
        signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        continue;
      }
      const json = await response.json() as {
        title?: string;
        content?: string;
        departments?: Array<{ name?: string }>;
        location?: { name?: string };
      };
      const text = formatGreenhouseJobText(json);
      if (text.length < 120) {
        log("POSTING_PREFETCH_THIN", { url, chars: text.length, ats: "greenhouse" });
        return null;
      }
      log("POSTING_PREFETCH_OK", {
        url,
        chars: text.length,
        ats: "greenhouse",
        slug: target.slug,
        jobId: target.jobId,
      });
      return text;
    } catch (error) {
      log("POSTING_PREFETCH_FAILED", {
        url,
        ats: "greenhouse",
        apiUrl,
        message: error instanceof Error ? error.message : "prefetch_failed",
      });
    }
  }
  return null;
}

export function resolveGreenhouseApiTarget(url: string): GreenhouseTarget | null {
  const direct = greenhouseTarget(url);
  if (direct) {
    return direct;
  }
  const candidates = [
    ...greenhouseJobPostUrls(url),
    ...greenhouseBoardUrls(url),
  ];
  for (const candidate of candidates) {
    const parsed = greenhouseTarget(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

export function formatGreenhouseJobText(job: {
  title?: string;
  content?: string;
  departments?: Array<{ name?: string }>;
  location?: { name?: string };
}): string {
  const parts: string[] = [];
  if (job.title?.trim()) {
    parts.push(`Title: ${job.title.trim()}`);
  }
  if (job.location?.name?.trim()) {
    parts.push(`Location: ${job.location.name.trim()}`);
  }
  const dept = job.departments?.map((row) => row.name?.trim()).filter(Boolean).join(", ");
  if (dept) {
    parts.push(`Department: ${dept}`);
  }
  const body = stripHtml(job.content ?? "").trim();
  if (body) {
    parts.push(body);
  }
  return parts.join("\n\n").slice(0, 12_000);
}

/** Comeet careers pages embed section JSON (Description, Requirements, …) in the HTML shell. */
export function extractComeetEmbeddedText(html: string): string {
  const sections: string[] = [];
  const re = /"name":\s*"([^"]+)",\s*"value":\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of html.matchAll(re)) {
    const name = match[1] ?? "";
    if (!/description|requirement|responsibilit|about|qualification|what you/i.test(name)) {
      continue;
    }
    const raw = match[2] ?? "";
    const decoded = decodeComeetJsonString(raw);
    const plain = stripHtml(decoded).trim();
    if (plain.length > 20) {
      sections.push(`${name}:\n${plain}`);
    }
  }
  if (sections.length === 0) {
    return stripHtml(html).slice(0, 12_000);
  }
  return sections.join("\n\n").slice(0, 12_000);
}

function decodeComeetJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value
      .replace(/\\u003C/gi, "<")
      .replace(/\\u003E/gi, ">")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"');
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

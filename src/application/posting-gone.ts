import { log } from "../logging/logger.js";

/**
 * Decides "this posting no longer exists" when the page itself does not say so.
 * Many removed postings do not show a 404: the ATS redirects to the company careers home, and a plain look at the
 * landing page then reads as "a page with no matching location". This module catches those honestly as closed.
 */

const GREENHOUSE_API_TIMEOUT_MS = 8_000;
const GREENHOUSE_API_HOST = "boards-api.greenhouse.io";
const GREENHOUSE_EU_API_HOST = "boards-api.eu.greenhouse.io";

/** Hosts that legitimately hand a visitor to another domain (ATS / aggregators), so a domain change proves nothing. */
const HAND_OFF_HOSTS = /(?:greenhouse\.io|workable\.com|lever\.co|comeet\.com|ashbyhq\.com|smartrecruiters\.com|teamtailor\.com|icims\.com|myworkdayjobs\.com|linkedin\.com|jobmaster\.co\.il|drushim\.co\.il|gotfriends\.co\.il|dialog\.co\.il|sqlink\.com)$/i;

const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "gov", "ac"]);

export type PostingGoneReason =
  | "greenhouse_api_404"
  | "redirected_to_home"
  | `redirected_away:${string}`;

type GreenhouseTarget = { apiHost: string; slug: string; jobId: string };

/** Parse slug + job id from boards.greenhouse.io / job-boards.greenhouse.io (+ EU) posting or embed URLs. */
export function greenhouseTarget(url: string): GreenhouseTarget | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)greenhouse\.io$/i.test(parsed.hostname)) {
      return null;
    }
    const apiHost = /\.eu\.greenhouse\.io$/i.test(parsed.hostname) ? GREENHOUSE_EU_API_HOST : GREENHOUSE_API_HOST;
    const token = parsed.searchParams.get("token");
    const forSlug = parsed.searchParams.get("for");
    if (token && /^\d+$/.test(token) && forSlug) {
      return { apiHost, slug: forSlug.toLowerCase(), jobId: token };
    }
    const match = parsed.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/i);
    if (match?.[1] && match[2] && !/^(embed|jobs)$/i.test(match[1])) {
      return { apiHost, slug: match[1].toLowerCase(), jobId: match[2] };
    }
  } catch {
    // Not a parseable URL: nothing to check.
  }
  return null;
}

/**
 * True only on a definitive answer: the job id is 404 while the board itself exists.
 * Any network trouble is "unknown" (false), never "gone".
 */
export async function greenhousePostingGone(url: string): Promise<boolean> {
  const target = greenhouseTarget(url);
  if (!target) {
    return false;
  }
  const base = `https://${target.apiHost}/v1/boards/${target.slug}`;
  try {
    const job = await fetch(`${base}/jobs/${target.jobId}`, { signal: AbortSignal.timeout(GREENHOUSE_API_TIMEOUT_MS) });
    if (job.status !== 404) {
      return false;
    }
    const board = await fetch(base, { signal: AbortSignal.timeout(GREENHOUSE_API_TIMEOUT_MS) });
    return board.ok;
  } catch (error) {
    log("POSTING_GONE_CHECK_FAILED", { url, message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) {
    return labels.join(".");
  }
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const take = tld.length === 2 && SECOND_LEVEL_LABELS.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function hasDeepPath(url: URL): boolean {
  return url.pathname.replace(/\/+$/, "") !== "";
}

/**
 * Pure redirect check: did opening a deep posting URL land somewhere that cannot be that posting?
 * - site root: a posting URL that ends on "/" has no posting.
 * - unrelated domain: a company page that sends the visitor to another site (hand-off ATS hosts excluded).
 */
export function redirectedAwayReason(originalUrl: string, landedUrl: string): PostingGoneReason | null {
  try {
    const original = new URL(originalUrl);
    const landed = new URL(landedUrl);
    if (!hasDeepPath(original)) {
      return null;
    }
    if (!hasDeepPath(landed) && !landed.search) {
      return "redirected_to_home";
    }
    const sameSite = registrableDomain(original.hostname) === registrableDomain(landed.hostname);
    if (!sameSite && !HAND_OFF_HOSTS.test(original.hostname) && !HAND_OFF_HOSTS.test(landed.hostname)) {
      return `redirected_away:${registrableDomain(landed.hostname)}`;
    }
  } catch {
    // Unparseable URL: no verdict.
  }
  return null;
}

/** Combines the definitive ATS answer with the redirect heuristics. Null = no evidence the posting is gone. */
export async function postingGoneReason(originalUrl: string, landedUrl: string): Promise<PostingGoneReason | null> {
  if (await greenhousePostingGone(originalUrl)) {
    return "greenhouse_api_404";
  }
  return redirectedAwayReason(originalUrl, landedUrl);
}

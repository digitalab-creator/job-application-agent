import { classifyJobPage, type JobPageStatus } from "./classify-page.js";
import { greenhousePostingGone, redirectedAwayReason } from "./posting-gone.js";
import { resolveGreenhouseApiTarget, formatGreenhouseJobText } from "./fetch-posting-text.js";
import { extractStrongJobId, isListingHubUrl, urlPath } from "./url-inspector.js";
import { log } from "../logging/logger.js";

const CLOSED_POSTING_PATTERN = new RegExp([
  "no longer accepting applications",
  "(?:job|position|role|posting|vacancy|listing|opportunity)[^.!?]{0,60}(?:is |has been |was )?no longer (?:available|active|open|posted|accepting)",
  "this (?:job|position|role|posting|listing) (?:has )?(?:expired|been removed|been filled|been closed)",
  "position (?:has been )?filled",
  "role has been filled",
  "job (?:is )?expired",
  "position (?:is )?closed",
  "applications (?:are|have been) closed",
  "we are no longer hiring for this",
  "המשרה אינה פעילה",
  "המשרה נסגרה",
  "המשרה אוישה",
  "המשרה הוסרה",
  "המשרה כבר לא",
  "המודעה הוסרה",
  "לא ניתן להגיש מועמדות",
].join("|"), "i");

const HUB_PATH_PATTERNS = [
  /^\/(?:home|index(?:\.\w{2,5})?|default(?:\.\w{2,5})?)$/i,
  /^\/[a-z]{2}(?:-[a-z]{2})?$/i,
  /\/(?:404|not-found|page-not-found|pagenotfound|error|expired|no-longer-available)$/i,
];

const NOT_FOUND_TITLE_PATTERN = /(?:\b404\b|page not found|page cannot be found|page (?:no longer|does ?n[o']?t) exist|הדף לא נמצא)/i;
const ERROR_QUERY_PATTERN = /[?&](?:error|errorcode|not_?found|jobnotfound|expired|invalid)(?:=[^&]*)?(?:&|$)/i;
const DEAD_HOST_FAILURE_PATTERN = /(?:dns error|(?:unable|could not|couldn't|failed) to resolve|name (?:not|could not be) resolved|no such host|nxdomain|unknown host|invalid (?:url|argument)|malformed url|enotfound)/i;

const MAX_REDIRECT_HOPS = 5;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 300_000;
const MAX_PARALLEL = 8;

export type LinkLivenessVerdict = {
  originalUrl: string;
  finalUrl: string;
  definitelyClosed: boolean;
  definitelyActive: boolean;
  unreachable: boolean;
  accessible: boolean;
  reason: string;
  httpStatus?: number;
  pageStatus?: JobPageStatus;
};

export async function inspectJobUrl(url: string, role = ""): Promise<LinkLivenessVerdict> {
  const results = await inspectJobUrls([{ url, role }]);
  return results[0]!;
}

export async function inspectJobUrls(
  targets: Array<{ url: string; role?: string }>,
): Promise<LinkLivenessVerdict[]> {
  const out: LinkLivenessVerdict[] = [];
  for (let i = 0; i < targets.length; i += MAX_PARALLEL) {
    const batch = targets.slice(i, i + MAX_PARALLEL).map((t) => ({
      url: String(t.url || "").trim(),
      role: String(t.role ?? "").trim(),
    }));
    const batchResults = await Promise.all(batch.map((item) => inspectOne(item.url, item.role)));
    out.push(...batchResults);
  }
  return out;
}

async function inspectOne(originalUrl: string, role: string): Promise<LinkLivenessVerdict> {
  if (!originalUrl) {
    return inconclusive(originalUrl, originalUrl, "Missing URL.");
  }

  if (await greenhousePostingGone(originalUrl)) {
    return closed(originalUrl, originalUrl, "greenhouse_api_404");
  }

  const greenhouseActive = await greenhouseActiveText(originalUrl);
  if (greenhouseActive?.state === "closed") {
    return closed(originalUrl, greenhouseActive.canonicalUrl, greenhouseActive.reason);
  }
  if (greenhouseActive?.state === "active") {
    return active(
      originalUrl,
      greenhouseActive.canonicalUrl,
      "Greenhouse API confirms posting is open.",
      200,
      "ACTIVE_JOB",
    );
  }

  try {
    const resolved = await resolveFinalResponse(originalUrl);
    if (resolved.verdict) {
      return resolved.verdict;
    }
    return classifyResponse(originalUrl, resolved.finalUrl, resolved.status, resolved.body, role);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("LINK_LIVENESS_FAILED", { url: originalUrl, message });
    if (DEAD_HOST_FAILURE_PATTERN.test(message)) {
      return closed(originalUrl, originalUrl, `Host no longer exists (${message}).`);
    }
    return unreachable(originalUrl, originalUrl, `Unreachable: ${message}`);
  }
}

async function greenhouseActiveText(url: string): Promise<
  | { state: "active"; canonicalUrl: string; text: string }
  | { state: "closed"; canonicalUrl: string; reason: string }
  | null
> {
  const target = resolveGreenhouseApiTarget(url);
  if (!target) {
    return null;
  }
  const apiUrl = `https://${target.apiHost}/v1/boards/${target.slug}/jobs/${target.jobId}`;
  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/json", "User-Agent": "job-application-agent/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const canonicalUrl = `https://job-boards.greenhouse.io/${target.slug}/jobs/${target.jobId}`;
    if (response.status === 404) {
      return { state: "closed", canonicalUrl, reason: "Greenhouse API returned 404 for job id." };
    }
    if (!response.ok) {
      return null;
    }
    const json = await response.json() as Record<string, unknown>;
    const text = formatGreenhouseJobText(json);
    if (text.length < 80) {
      return null;
    }
    return { state: "active", canonicalUrl, text };
  } catch {
    return null;
  }
}

type ResolvedHop = {
  finalUrl: string;
  status: number;
  body: string;
  verdict?: LinkLivenessVerdict;
};

async function resolveFinalResponse(originalUrl: string): Promise<ResolvedHop> {
  let currentUrl = originalUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const redirectVerdict = hop > 0 ? classifyRedirectTarget(originalUrl, currentUrl) : null;
    if (redirectVerdict) {
      return {
        finalUrl: currentUrl,
        status: 0,
        body: "",
        verdict: closed(originalUrl, currentUrl, redirectVerdict),
      };
    }

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; job-application-agent/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (DEAD_HOST_FAILURE_PATTERN.test(message)) {
        return {
          finalUrl: currentUrl,
          status: 0,
          body: "",
          verdict: closed(originalUrl, currentUrl, `Host no longer exists (${message}).`),
        };
      }
      return {
        finalUrl: currentUrl,
        status: 0,
        body: "",
        verdict: unreachable(originalUrl, currentUrl, `Unreachable: ${message}`),
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop >= MAX_REDIRECT_HOPS) {
        return {
          finalUrl: currentUrl,
          status: response.status,
          body: "",
          verdict: inconclusive(originalUrl, currentUrl, `HTTP ${response.status}; redirect chain did not resolve.`),
        };
      }
      const target = resolveRedirectUrl(location, currentUrl);
      const early = classifyRedirectTarget(originalUrl, target);
      if (early) {
        return {
          finalUrl: target,
          status: 0,
          body: "",
          verdict: closed(originalUrl, target, early),
        };
      }
      currentUrl = target;
      continue;
    }

    const body = (await response.text()).slice(0, MAX_BODY_CHARS);
    return { finalUrl: currentUrl, status: response.status, body };
  }

  return {
    finalUrl: currentUrl,
    status: 0,
    body: "",
    verdict: inconclusive(originalUrl, currentUrl, "Redirect hop limit exceeded."),
  };
}

function classifyResponse(
  originalUrl: string,
  finalUrl: string,
  status: number,
  html: string,
  role: string,
): LinkLivenessVerdict {
  if (status === 404 || status === 410) {
    return closed(originalUrl, finalUrl, `Direct page returned HTTP ${status}.`);
  }
  if (status === 401 || status === 403) {
    return inconclusive(originalUrl, finalUrl, `HTTP ${status}; public access blocked or login wall.`);
  }
  if (status >= 300 && status < 400) {
    return inconclusive(originalUrl, finalUrl, `HTTP ${status}; redirect chain did not resolve.`);
  }
  if (status < 200 || status >= 400) {
    return inconclusive(originalUrl, finalUrl, `HTTP ${status}; treated as inconclusive.`);
  }

  const goneRedirect = redirectedAwayReason(originalUrl, finalUrl);
  if (goneRedirect) {
    return closed(originalUrl, finalUrl, goneRedirect);
  }

  const plain = stripHtml(html);
  if (/janglo\.net/i.test(finalUrl) && isJangloRemovedListingPage(plain)) {
    return closed(originalUrl, finalUrl, "Janglo listing page is invalid or the post was removed.");
  }
  if (isNotFoundTitle(html)) {
    return closed(originalUrl, finalUrl, "Page title reports a missing page (soft 404).");
  }
  if (CLOSED_POSTING_PATTERN.test(plain)) {
    return closed(originalUrl, finalUrl, "Direct page contains explicit closed/expired wording.");
  }

  const title = extractTitle(html);
  const pageStatus = classifyJobPage({ url: finalUrl, title, text: plain, role });
  if (pageStatus === "CLOSED" || pageStatus === "NOT_FOUND") {
    return closed(originalUrl, finalUrl, `Page classified as ${pageStatus}.`);
  }
  if (pageStatus === "LOGIN_WALL") {
    return inconclusive(originalUrl, finalUrl, "Login wall; cannot confirm posting without auth.");
  }
  if (pageStatus === "ACTIVE_JOB") {
    return active(originalUrl, finalUrl, "Posting page shows an active apply surface.", status, pageStatus);
  }
  if (pageStatus === "CAREERS_PAGE") {
    return inconclusive(originalUrl, finalUrl, "Landed on a careers hub, not a specific posting.");
  }
  return inconclusive(originalUrl, finalUrl, "HTTP 200 without proof the specific posting remains open.");
}

export function classifyRedirectTarget(originalUrl: string, finalUrl: string): string | null {
  const from = normalizeUrlForCompare(originalUrl);
  const to = normalizeUrlForCompare(finalUrl);
  if (!to || from === to) {
    return null;
  }
  if (isHubOrRootUrl(finalUrl)) {
    return `Redirected to a hub or site root (${finalUrl}); the posting is gone.`;
  }
  if (ERROR_QUERY_PATTERN.test(finalUrl)) {
    return `Redirected to an error page (${finalUrl}); the posting is gone.`;
  }
  const postingId = extractStrongJobId(originalUrl);
  if (postingId && !finalUrl.toLowerCase().includes(String(postingId).toLowerCase())) {
    return `Redirected away from posting ${postingId} to ${finalUrl}.`;
  }
  return null;
}

export function isHubOrRootUrl(url: string): boolean {
  const path = urlPathOnly(url).replace(/\/+$/, "");
  if (!path) {
    return true;
  }
  if (HUB_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return true;
  }
  return isListingHubUrl(url);
}

function urlPathOnly(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return urlPath(url);
  }
}

// urlPath imported from url-inspector for fallback parsing

function resolveRedirectUrl(location: string, baseUrl: string): string {
  const value = location.trim();
  if (!value) {
    return baseUrl;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function isNotFoundTitle(html: string): boolean {
  const match = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!match?.[1]) {
    return false;
  }
  return NOT_FOUND_TITLE_PATTERN.test(stripHtml(match[1]));
}

function isJangloRemovedListingPage(plainText: string): boolean {
  const value = plainText.trim();
  if (!value) {
    return false;
  }
  return /invalid\s+url/i.test(value)
    || /listing\s+(?:is\s+)?(?:no longer|not)\s+(?:available|active)/i.test(value)
    || /this\s+(?:listing|post)\s+(?:has been\s+)?(?:removed|deleted|expired)/i.test(value);
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]{0,500}?)<\/title>/i);
  return match?.[1] ? stripHtml(match[1]) : "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrlForCompare(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function closed(originalUrl: string, finalUrl: string, reason: string): LinkLivenessVerdict {
  return {
    originalUrl,
    finalUrl,
    definitelyClosed: true,
    definitelyActive: false,
    unreachable: false,
    accessible: false,
    reason,
  };
}

function active(
  originalUrl: string,
  finalUrl: string,
  reason: string,
  httpStatus: number,
  pageStatus: JobPageStatus,
): LinkLivenessVerdict {
  return {
    originalUrl,
    finalUrl,
    definitelyClosed: false,
    definitelyActive: true,
    unreachable: false,
    accessible: true,
    reason,
    httpStatus,
    pageStatus,
  };
}

function inconclusive(originalUrl: string, finalUrl: string, reason: string): LinkLivenessVerdict {
  return {
    originalUrl,
    finalUrl,
    definitelyClosed: false,
    definitelyActive: false,
    unreachable: false,
    accessible: false,
    reason,
  };
}

function unreachable(originalUrl: string, finalUrl: string, reason: string): LinkLivenessVerdict {
  return {
    originalUrl,
    finalUrl,
    definitelyClosed: false,
    definitelyActive: false,
    unreachable: true,
    accessible: false,
    reason,
  };
}

// Re-export for tests
export { urlPathOnly as urlPathForHubCheck };

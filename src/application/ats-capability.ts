import { isKnownBlockedApplyUrl, parseHttpUrl } from "./automatable-url.js";
import { linkedinEasyApplyEnabled } from "./linkedin-easy-apply.js";

/**
 * Closed capability contract for queue eligibility.
 * One resolver owns truth — n8n / reports / pick consume this enum.
 */
export type AtsCapability =
  | "supported_auto"
  | "resolvable"
  | "manual_only"
  | "invalid";

const MANUAL_HOST_RE =
  /linkedin\.com|gotfriends\.co\.il|dialog\.co\.il|drushim\.co\.il|sqlink\.com|jobmaster\.co\.il|comblack\.co\.il|indeed\.com|glassdoor\.com/i;

const SUPPORTED_AUTO_RE =
  /comeet\.com|boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|myworkdayjobs\.com/i;

/** SmartRecruiters enters auto only after canary — keep resolvable/manual until then. */
const RESOLVABLE_RE = /smartrecruiters\.com|jobs\.smartrecruiters\.com/i;

export function resolveApplyCapability(url: string): AtsCapability {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return "invalid";
  }
  const href = parsed.toString();
  if (isKnownBlockedApplyUrl(href)) {
    return "invalid";
  }
  // Category/search links are not individual openings, even if their host normally supports apply.
  if (isListingOrSearchPage(parsed)) {
    return "manual_only";
  }
  if (/(^|\.)linkedin\.com$/i.test(parsed.hostname) && !linkedinEasyApplyEnabled()) {
    return "manual_only";
  }
  if (MANUAL_HOST_RE.test(parsed.hostname) || MANUAL_HOST_RE.test(href)) {
    if (isAggregatorListPage(href, parsed.pathname)) {
      return "manual_only";
    }
    return "resolvable";
  }
  if (SUPPORTED_AUTO_RE.test(href) || SUPPORTED_AUTO_RE.test(parsed.hostname)) {
    return "supported_auto";
  }
  if (RESOLVABLE_RE.test(href) || RESOLVABLE_RE.test(parsed.hostname)) {
    return "resolvable";
  }
  // Unknown ATS: try auto (same as today's "any real http job" policy) unless clearly a list/search page.
  if (/[?&](q|query|search|keywords)=/i.test(href) || /\/(jobs|careers)\/?$/i.test(parsed.pathname)) {
    return "manual_only";
  }
  return "supported_auto";
}

export function isAutomatableCapability(capability: AtsCapability): boolean {
  return capability === "supported_auto" || capability === "resolvable";
}

/** Conservative known-host listing patterns; never mistake an ATS board for a job. */
function isListingOrSearchPage(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase().replace(/\\/+$/, "") || "/";
  if (/(^|\\.)drushim\\.co\\.il$/.test(host) && /^\\/jobs\\/(subcat|cat|category|q-)/.test(path)) return true;
  if (/(^|\\.)jobmaster\\.co\\.il$/.test(host) && /^\\/jobs\\/(q-|search|category)/.test(path)) return true;
  if (/(^|\\.)linkedin\\.com$/.test(host) && /^\\/jobs\\/(search|collections)(?:\\/|$)/.test(path)) return true;
  if (/(^|\\.)gotfriends\\.co\\.il$/.test(host) && /^\\/jobslobby\\//.test(path) && !/\\/\\d+$/.test(path)) return true;
  if (/(^|\\.)comeet\\.com$/.test(host) && /^\\/jobs\\/[^/]+\\/?$/.test(path)) return true;
  if (/^(boards\\.greenhouse\\.io|job-boards\\.greenhouse\\.io)$/.test(host) && !/\\/jobs\\/\\d+(?:\\/|$)/.test(path)) return true;
  if (host === "jobs.lever.co" && /^\\/[^/]+$/.test(path)) return true;
  if (/^(jobs\\.ashbyhq\\.com)$/.test(host) && /^\\/[^/]+$/.test(path)) return true;
  if (/(^|\\.)indeed\\.com$/.test(host) && path === "/jobs") return true;
  return false;
}

function isAggregatorListPage(href: string, pathname: string): boolean {
  if (/\/jobs\/view\/\d+/i.test(href)) {
    return false;
  }
  if (/jobpage\?positionId=/i.test(href) || /\/job\/\d+/i.test(pathname)) {
    return false;
  }
  if (/[?&](q|query|search|keywords|page)=/i.test(href)) {
    return true;
  }
  return /\/(jobs|careers|jobslobby)\/?$/i.test(pathname);
}

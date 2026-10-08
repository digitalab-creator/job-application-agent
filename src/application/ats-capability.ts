import { parseHttpUrl } from "./automatable-url.js";

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
  const lower = href.toLowerCase();
  if (lower.includes("/jobs/stampli/") && lower.includes("0b.273")) {
    return "invalid";
  }
  if (/^https:\/\/apply\.workable\.com\/comeet\//i.test(href)) {
    return "invalid";
  }
  if (MANUAL_HOST_RE.test(parsed.hostname) || MANUAL_HOST_RE.test(href)) {
    return "manual_only";
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

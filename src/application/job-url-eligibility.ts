import { extractHttpUrlFromCell, parseHttpUrl } from "./automatable-url.js";
import {
  isAutomatableCapability,
  resolveApplyCapability,
  type AtsCapability,
} from "./ats-capability.js";
import { isSpecificJobUrl, isUnverifiableUrl } from "./url-inspector.js";

export type JobUrlRejectReason =
  | "invalid_url"
  | "unverifiable"
  | "non_specific_posting"
  | "blocked_listing"
  | "manual_only_platform";

export type JobUrlEligibility = {
  url: string;
  specific: boolean;
  capability: AtsCapability;
  automatable: boolean;
  rejectReason?: JobUrlRejectReason;
};

export function isSpecificEmployerJobUrl(rawUrl: string): boolean {
  const value = extractHttpUrlFromCell(rawUrl) ?? String(rawUrl || "").trim();
  return isSpecificJobUrl(value);
}

export function evaluateJobUrlEligibility(rawUrl: string): JobUrlEligibility {
  const url = extractHttpUrlFromCell(rawUrl) ?? String(rawUrl || "").trim();
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return {
      url,
      specific: false,
      capability: "invalid",
      automatable: false,
      rejectReason: "invalid_url",
    };
  }
  const href = parsed.toString();
  const capability = resolveApplyCapability(href);
  if (capability === "invalid") {
    return {
      url: href,
      specific: false,
      capability,
      automatable: false,
      rejectReason: "blocked_listing",
    };
  }
  if (isUnverifiableUrl(href)) {
    return {
      url: href,
      specific: false,
      capability,
      automatable: false,
      rejectReason: "unverifiable",
    };
  }
  const specific = isSpecificEmployerJobUrl(href);
  if (!specific) {
    return {
      url: href,
      specific: false,
      capability,
      automatable: false,
      rejectReason: "non_specific_posting",
    };
  }
  const automatable = isAutomatableCapability(capability);
  return {
    url: href,
    specific: true,
    capability,
    automatable,
    rejectReason: automatable ? undefined : "manual_only_platform",
  };
}

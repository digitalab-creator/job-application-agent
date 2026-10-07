import { classifyLocationDetailed } from "../discovery/location-eligibility.js";
import type { JobRequirements } from "./job-fit.js";

/** Rule evidence strong enough to reject on. "no_location_signal" / needs_lookup are NOT: the model may just be vague. */
const REJECTING_EVIDENCE = new Set(["blocked_city", "foreign_only", "other_israel_region"]);

const UNSTATED_LOCATION = /^(unknown|n\/?a|not (specified|stated)|none|-)?$/i;

/**
 * Model thinks, code guards: the job-fit model states where the role is. Reject only when that stated
 * location is clearly outside policy (blocked city, foreign-only, other Israeli region).
 * Returns the evidence, or null to continue.
 */
export function fitLocationRejection(
  requirements: Pick<JobRequirements, "location" | "workMode">,
  role: string,
): string | null {
  const stated = requirements.location.trim();
  if (UNSTATED_LOCATION.test(stated)) {
    return null;
  }
  const detail = classifyLocationDetailed(role, `${requirements.workMode} ${stated}`, "");
  return detail.verdict === "ineligible" && REJECTING_EVIDENCE.has(detail.evidence) ? detail.evidence : null;
}

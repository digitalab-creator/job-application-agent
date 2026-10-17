import { parseHttpUrl } from "./automatable-url.js";
import { uniqueKeyForUrl } from "./job-posting-identity.js";
import { getWorkspaceRuntime } from "../orchestration/workspace-runtime.js";
import type { SubmissionScope } from "../models/types.js";

export type { SubmissionScope };

export type VerifiedAgencyId = "gotfriends.co.il";

const VERIFIED_AGENCY_HOSTS = new Set<VerifiedAgencyId>(["gotfriends.co.il"]);

export function normalizeAgencyHost(hostname: string): VerifiedAgencyId | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return VERIFIED_AGENCY_HOSTS.has(host as VerifiedAgencyId)
    ? (host as VerifiedAgencyId)
    : null;
}

/** GotFriends מס' משרה — last numeric path segment on job detail URLs. */
export function gotFriendsPostingIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!normalizeAgencyHost(parsed.hostname)) {
      return null;
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last || !/^\d{5,7}$/.test(last)) {
      return null;
    }
    return last;
  } catch {
    return null;
  }
}

export function resolveIntendedScopeFromUrl(url: string): SubmissionScope {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return "direct_employer_application";
  }
  const agencyId = normalizeAgencyHost(parsed.hostname);
  if (!agencyId) {
    return "direct_employer_application";
  }
  const postingId = gotFriendsPostingIdFromUrl(parsed.toString());
  return postingId ? "agency_job_interest" : "agency_registration";
}

export function workspaceIdForDedup(explicit?: string): string {
  return explicit?.trim()
    || getWorkspaceRuntime()?.workspaceId
    || "internal";
}

export function submissionDedupKey(input: {
  workspaceId?: string;
  scope: SubmissionScope;
  agencyId?: string | null;
  postingId?: string | null;
  jobUrl?: string;
}): string | null {
  const workspaceId = workspaceIdForDedup(input.workspaceId);
  if (input.scope === "direct_employer_application") {
    if (!input.jobUrl) {
      return null;
    }
    return `direct:${workspaceId}:${uniqueKeyForUrl(input.jobUrl)}`;
  }
  if (!input.agencyId) {
    return null;
  }
  if (input.scope === "agency_registration") {
    return `agency_reg:${workspaceId}:${input.agencyId}`;
  }
  if (input.scope === "agency_job_interest") {
    if (!input.postingId) {
      return null;
    }
    return `agency_job:${workspaceId}:${input.agencyId}:${input.postingId}`;
  }
  return null;
}

export function countsAsConfirmedEmployerApplication(scope: SubmissionScope): boolean {
  return scope === "direct_employer_application";
}

export function agencyContextFromUrl(url: string): {
  agencyId: VerifiedAgencyId | null;
  postingId: string | null;
  intendedScope: SubmissionScope;
} {
  const parsed = parseHttpUrl(url);
  const agencyId = parsed ? normalizeAgencyHost(parsed.hostname) : null;
  const postingId = gotFriendsPostingIdFromUrl(url);
  const intendedScope = resolveIntendedScopeFromUrl(url);
  return { agencyId, postingId, intendedScope };
}

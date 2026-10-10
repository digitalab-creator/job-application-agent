import type { LedgerEntry } from "./ledger-policy.js";
import { readLedger } from "./ledger.js";
import { isTerminalLedgerEntry } from "./ledger-policy.js";
import {
  agencyContextFromUrl,
  submissionDedupKey,
  type SubmissionScope,
  workspaceIdForDedup,
} from "./submission-scope.js";

export type ScopeDedupHit = {
  key: string;
  scope: SubmissionScope;
  entry: LedgerEntry;
};

export function priorTerminalByDedupKey(
  key: string,
  entries: LedgerEntry[] = readLedger(),
): LedgerEntry | undefined {
  return entries
    .filter((entry) => entry.dedupKey === key)
    .reverse()
    .find((entry) => isTerminalLedgerEntry(entry));
}

export function priorScopeTerminalForUrl(
  url: string,
  workspaceId?: string,
  entries: LedgerEntry[] = readLedger(),
): ScopeDedupHit | null {
  const { agencyId, postingId, intendedScope } = agencyContextFromUrl(url);
  const ws = workspaceIdForDedup(workspaceId);
  const scopesToCheck: SubmissionScope[] = [intendedScope];
  if (intendedScope === "agency_job_interest") {
    scopesToCheck.push("agency_registration");
  }
  for (const scope of scopesToCheck) {
    const key = submissionDedupKey({
      workspaceId: ws,
      scope,
      agencyId,
      postingId: scope === "agency_job_interest" ? postingId : null,
      jobUrl: scope === "direct_employer_application" ? url : undefined,
    });
    if (!key) {
      continue;
    }
    const entry = priorTerminalByDedupKey(key, entries);
    if (entry?.confirmationDetected) {
      return { key, scope, entry };
    }
  }
  return null;
}

export function shouldSkipApplyForScopeDedup(
  url: string,
  workspaceId?: string,
  entries: LedgerEntry[] = readLedger(),
): { skip: boolean; reason?: string; hit?: ScopeDedupHit } {
  const { intendedScope, agencyId, postingId } = agencyContextFromUrl(url);
  if (!agencyId) {
    const directKey = submissionDedupKey({
      workspaceId,
      scope: "direct_employer_application",
      jobUrl: url,
    });
    if (directKey) {
      const hit = priorTerminalByDedupKey(directKey, entries);
      if (hit?.confirmationDetected) {
        return { skip: true, reason: "already_submitted", hit: { key: directKey, scope: "direct_employer_application", entry: hit } };
      }
    }
    return { skip: false };
  }
  if (intendedScope === "agency_job_interest" && postingId) {
    const jobKey = submissionDedupKey({
      workspaceId,
      scope: "agency_job_interest",
      agencyId,
      postingId,
    });
    if (jobKey) {
      const jobHit = priorTerminalByDedupKey(jobKey, entries);
      if (jobHit?.confirmationDetected) {
        return {
          skip: true,
          reason: "agency_job_interest_exists",
          hit: { key: jobKey, scope: "agency_job_interest", entry: jobHit },
        };
      }
    }
    return { skip: false };
  }
  if (intendedScope === "agency_registration") {
    const regKey = submissionDedupKey({
      workspaceId,
      scope: "agency_registration",
      agencyId,
    });
    if (regKey) {
      const regHit = priorTerminalByDedupKey(regKey, entries);
      if (regHit?.confirmationDetected) {
        return {
          skip: true,
          reason: "agency_registration_exists",
          hit: { key: regKey, scope: "agency_registration", entry: regHit },
        };
      }
    }
  }
  return { skip: false };
}

export function enrichLedgerEntryForScope(
  base: LedgerEntry,
  input: {
    url: string;
    workspaceId?: string;
    scope: SubmissionScope;
    agencyId?: string | null;
    postingId?: string | null;
  },
): LedgerEntry {
  const agencyId = input.agencyId ?? agencyContextFromUrl(input.url).agencyId;
  const postingId = input.postingId ?? agencyContextFromUrl(input.url).postingId;
  const dedupKey = submissionDedupKey({
    workspaceId: input.workspaceId,
    scope: input.scope,
    agencyId,
    postingId,
    jobUrl: input.url,
  });
  return {
    ...base,
    submissionScope: input.scope,
    agencyId: agencyId ?? undefined,
    postingId: postingId ?? undefined,
    dedupKey: dedupKey ?? undefined,
  };
}

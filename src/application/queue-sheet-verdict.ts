import type { AtsCapability } from "./ats-capability.js";
import { resolveApplyCapability, isAutomatableCapability } from "./ats-capability.js";
import { extractHttpUrlFromCell } from "./automatable-url.js";
import { navigationRetryUrls } from "./job-navigation-url.js";
import type { LinkLivenessVerdict } from "./link-liveness.js";
import { isSpecificEmployerJobUrl } from "./job-url-eligibility.js";
import { isUnverifiableUrl } from "./url-inspector.js";
import { readNoteTag, setNoteTag } from "./sheet-note-tags.js";

export const PRESERVE_QUEUE_STATUSES = new Set([
  "Applied",
  "Interview",
  "Offer",
  "Hired",
  "Agency Registered",
  "Agency Referred",
]);

const MANUAL_BLOCKER_RE = /result=manual_fill|blocker=(captcha|login_required|missing_fact|form_validation|cv_upload_failed|submit_not_accepted)/i;

export type QueueStatusRecommendation = {
  status: "Manual" | "Review" | "Closed" | "New";
  reason: string;
  canonicalUrl?: string;
  verifiedAt: string;
  evidence: string;
  notesPatch?: string;
};

export function recoverCanonicalJobUrls(rawCell: string): string[] {
  const extracted = extractHttpUrlFromCell(rawCell);
  if (!extracted) {
    return [];
  }
  const candidates = [...new Set([extracted, ...navigationRetryUrls(extracted)])];
  return candidates.filter((url) => /^https?:\/\//i.test(url));
}

export function sheetRowHasManualBlocker(notes: string): boolean {
  return MANUAL_BLOCKER_RE.test(String(notes || ""));
}

export function appendVerificationNote(
  notes: string,
  line: string,
  verifiedAt: string,
): string {
  const base = setNoteTag(notes, "verified_at", verifiedAt.slice(0, 10));
  const tagLine = `verify=${line}`;
  if (base.includes(tagLine)) {
    return base;
  }
  return [tagLine, base].filter(Boolean).join("\n");
}

export function recommendQueueStatus(input: {
  currentStatus: string;
  notes: string;
  rawJobUrl: string;
  role: string;
  capability: AtsCapability;
  liveness: LinkLivenessVerdict;
  verifiedAt: string;
}): QueueStatusRecommendation | null {
  const status = String(input.currentStatus ?? "").trim();
  if (PRESERVE_QUEUE_STATUSES.has(status)) {
    return null;
  }

  const canonicalUrl = input.liveness.finalUrl !== input.liveness.originalUrl
    ? input.liveness.finalUrl
    : undefined;
  const evidence = input.liveness.reason || "no evidence recorded";

  if (input.liveness.definitelyClosed) {
    return {
      status: "Closed",
      reason: "posting_closed",
      canonicalUrl,
      verifiedAt: input.verifiedAt,
      evidence,
      notesPatch: appendVerificationNote(
        input.notes,
        `closed ${evidence}`.slice(0, 240),
        input.verifiedAt,
      ),
    };
  }

  if (input.liveness.unreachable || (!input.liveness.definitelyActive && !input.liveness.definitelyClosed)) {
    const strikes = Number(readNoteTag(input.notes, "unreachable")) || 0;
    const nextStrikes = input.liveness.unreachable ? strikes + 1 : 0;
    const notesWithStrikes = input.liveness.unreachable
      ? setNoteTag(input.notes, "unreachable", nextStrikes)
      : setNoteTag(input.notes, "unreachable", "");
    if (status === "Manual" && sheetRowHasManualBlocker(input.notes)) {
      return {
        status: "Manual",
        reason: "manual_blocker_inconclusive_liveness",
        canonicalUrl,
        verifiedAt: input.verifiedAt,
        evidence,
        notesPatch: appendVerificationNote(notesWithStrikes, `inconclusive ${evidence}`.slice(0, 200), input.verifiedAt),
      };
    }
    return {
      status: "Review",
      reason: input.liveness.unreachable ? "unreachable" : "unverified",
      canonicalUrl,
      verifiedAt: input.verifiedAt,
      evidence,
      notesPatch: appendVerificationNote(notesWithStrikes, `review ${evidence}`.slice(0, 200), input.verifiedAt),
    };
  }

  if (!input.liveness.definitelyActive) {
    return {
      status: "Review",
      reason: "not_proven_active",
      canonicalUrl,
      verifiedAt: input.verifiedAt,
      evidence,
      notesPatch: appendVerificationNote(input.notes, `review ${evidence}`.slice(0, 200), input.verifiedAt),
    };
  }

  const urlForCapability = canonicalUrl ?? extractHttpUrlFromCell(input.rawJobUrl) ?? input.liveness.finalUrl;
  const capability = input.capability === "invalid"
    ? resolveApplyCapability(urlForCapability)
    : input.capability;

  if (!isSpecificEmployerJobUrl(urlForCapability) || isUnverifiableUrl(urlForCapability)) {
    return {
      status: "Review",
      reason: "non_specific_or_unverifiable_url",
      canonicalUrl,
      verifiedAt: input.verifiedAt,
      evidence,
      notesPatch: appendVerificationNote(input.notes, "review non_specific_url", input.verifiedAt),
    };
  }

  if (sheetRowHasManualBlocker(input.notes)) {
    return {
      status: "Manual",
      reason: "verified_active_manual_blocker",
      canonicalUrl,
      verifiedAt: input.verifiedAt,
      evidence,
      notesPatch: appendVerificationNote(input.notes, `manual ${evidence}`.slice(0, 200), input.verifiedAt),
    };
  }

  if (isAutomatableCapability(capability)) {
    return {
      status: "New",
      reason: "verified_active_automatable",
      canonicalUrl,
      verifiedAt: input.verifiedAt,
      evidence,
      notesPatch: appendVerificationNote(input.notes, `auto ${evidence}`.slice(0, 200), input.verifiedAt),
    };
  }

  if (capability === "manual_only") {
    return {
      status: "Manual",
      reason: "verified_active_platform_manual",
      canonicalUrl,
      verifiedAt: input.verifiedAt,
      evidence,
      notesPatch: appendVerificationNote(
        input.notes,
        `manual platform ${evidence}`.slice(0, 200),
        input.verifiedAt,
      ),
    };
  }

  return {
    status: "Review",
    reason: "verified_active_unknown_capability",
    canonicalUrl,
    verifiedAt: input.verifiedAt,
    evidence,
    notesPatch: appendVerificationNote(input.notes, `review ${evidence}`.slice(0, 200), input.verifiedAt),
  };
}

/** Classify-only helper (no liveness): never promote to Manual from capability alone. */
export function recommendStatusFromCapabilityOnly(
  capability: AtsCapability,
  rawJobUrl = "",
): "Closed" | "Review" | "New" | "Manual" {
  if (capability === "invalid") {
    return "Closed";
  }
  if (rawJobUrl && !isSpecificEmployerJobUrl(rawJobUrl)) {
    return "Review";
  }
  if (capability === "supported_auto" || capability === "resolvable") {
    return "New";
  }
  if (capability === "manual_only") {
    return rawJobUrl && isSpecificEmployerJobUrl(rawJobUrl) ? "Manual" : "Review";
  }
  return "Review";
}

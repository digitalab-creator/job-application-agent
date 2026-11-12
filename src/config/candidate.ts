import { AsyncLocalStorage } from "node:async_hooks";
import { unitTestCandidateProfile } from "../test-fixtures/candidate-profile-fixture.js";

/**
 * Buyer identity for forms, CV, and fit. Loaded from workspace `profile_json` in Postgres.
 * Installed per run via `withCandidateProfile` / `withWorkspaceRuntime`.
 */
export type CandidateProfile = {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: { local: string; display: string; international: string };
  location: { city: string; country: string };
  workLocation: { willingToCommuteToEligibleOffices: boolean };
  linkedin: string;
  github: string;
  portfolio: { marketing: string; build: string; automation: string };
  workAuthorization: {
    israel: boolean;
    sponsorshipIsrael: boolean;
    euCitizen: boolean;
    euCountry: string;
    passports: string[];
  };
  noticePeriod: string;
  lastSalary: { amount: number; currency: string; period: "month" | "year"; annualAmount: number };
  salaryExpectation: {
    minimum: number;
    maximum: number;
    currency: string;
    period: "month" | "year";
    opportunityFilter: { excludeBelow: number; processingMinimum: number };
  };
  languages: Array<{ language: string; level: string }>;
  media: {
    ppcYears: number;
    maxMonthlyBudgetIls: number;
    primaryPaidMediaFocus: string;
    platforms: string[];
  };
  screening: {
    motivationTechnical: string;
    motivationMarketing: string;
    motivationHybrid: string;
    motivationRevenueMartech: string;
  };
  crm: { hasUsedHubSpot: boolean; summary: string };
};

export type PersonaMotivation = keyof CandidateProfile["screening"];

const profileStore = new AsyncLocalStorage<CandidateProfile>();

const NO_PROFILE_MESSAGE =
  "No candidate profile in context. Load workspace profile_json from Postgres before apply/discovery.";

function runtimeCandidateFallback(): CandidateProfile | null {
  if (process.env.NODE_ENV === "test") {
    return unitTestCandidateProfile;
  }
  return null;
}

/** Profile for the current async run (workspace row or explicit `withCandidateProfile`). */
export function activeCandidate(): CandidateProfile {
  const profile = profileStore.getStore() ?? runtimeCandidateFallback();
  if (!profile) {
    throw new Error(NO_PROFILE_MESSAGE);
  }
  return profile;
}

export function withCandidateProfile<T>(profile: CandidateProfile, fn: () => Promise<T>): Promise<T> {
  return profileStore.run(profile, fn);
}

/** Sync helper for unit tests. */
export function runWithCandidateProfile<T>(profile: CandidateProfile, fn: () => T): T {
  return profileStore.run(profile, fn);
}

/**
 * Reads follow the active workspace profile. Call sites keep `candidate.email`
 * and still see the buyer for this run.
 */
export const candidate: CandidateProfile = new Proxy({} as CandidateProfile, {
  get(_target, prop, receiver) {
    return Reflect.get(activeCandidate(), prop, receiver);
  },
});

export function parseCandidateProfile(value: unknown): CandidateProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<CandidateProfile>;
  if (!row.email?.trim() || !row.fullName?.trim() || !row.phone?.international?.trim()) {
    return null;
  }
  if (!row.salaryExpectation || !row.media || !row.screening || !row.workAuthorization) {
    return null;
  }
  return row as CandidateProfile;
}

export function candidateCvFileSlug(profile: CandidateProfile = activeCandidate()): string {
  const base = `${profile.firstName}-${profile.lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "candidate";
}

export function salaryMinimum(): number {
  return activeCandidate().salaryExpectation.minimum;
}

export function salaryMaximum(): number {
  return activeCandidate().salaryExpectation.maximum;
}

/** Single source of truth for forms, facts, and LLM payloads about citizenship. */
export function workAuthorizationSummary(): string {
  const { passports, euCitizen, euCountry, sponsorshipIsrael } = activeCandidate().workAuthorization;
  const passportList = passports.join(" and ");
  const euLine = euCitizen ? ` EU citizen (${euCountry}).` : "";
  const israelLine = sponsorshipIsrael
    ? " May require employer visa sponsorship for work in Israel."
    : " Authorized to work in Israel without employer visa sponsorship.";
  return `Holds ${passportList} passports.${euLine}${israelLine}`;
}

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Buyer identity for forms, CV, and fit. Workspace `internal` is seeded from
 * `internalCandidateProfile`. A run installs another buyer's copy via `withCandidateProfile`.
 *
 * On branch `main` this is fictional demo data for public reference. Real profile: branch `private/full`.
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

/** Seed for workspace `internal` only. Replace with your profile before production use. */
export const internalCandidateProfile: CandidateProfile = {
  firstName: "Alex",
  lastName: "Demo",
  fullName: "Alex Demo",
  email: "alex.demo@example.com",
  phone: {
    local: "5550100",
    display: "555-0100",
    international: "+15550100",
  },
  location: {
    city: "Petah Tikva",
    country: "Israel",
  },
  workLocation: {
    willingToCommuteToEligibleOffices: true,
  },
  linkedin: "https://www.linkedin.com/in/example",
  github: "https://github.com/example",
  portfolio: {
    marketing: "https://example.com/portfolio/marketing",
    build: "https://example.com/portfolio/build",
    automation: "https://example.com/portfolio/automation",
  },
  workAuthorization: {
    israel: true,
    sponsorshipIsrael: false,
    euCitizen: false,
    euCountry: "",
    passports: ["Example"],
  },
  noticePeriod: "2 weeks",
  lastSalary: {
    amount: 22000,
    currency: "ILS",
    period: "month" as const,
    annualAmount: 264000,
  },
  salaryExpectation: {
    minimum: 20000,
    maximum: 30000,
    currency: "ILS",
    period: "month" as const,
    opportunityFilter: {
      excludeBelow: 18000,
      processingMinimum: 20000,
    },
  },
  languages: [
    { language: "English", level: "Fluent" },
    { language: "Hebrew", level: "Professional" },
  ],
  media: {
    ppcYears: 8,
    maxMonthlyBudgetIls: 500_000,
    primaryPaidMediaFocus: "Full-funnel growth (acquisition, CRO, and analytics)",
    platforms: ["Google", "Meta", "Taboola", "LinkedIn", "Microsoft Ads"],
  },
  screening: {
    motivationTechnical:
      "Full-stack engineer with production AI delivery experience; interested in owning reliable systems end-to-end.",
    motivationMarketing:
      "Performance marketer with paid acquisition, measurement, and budget ownership across major platforms.",
    motivationHybrid:
      "Revenue and MarTech lead connecting marketing, CRM, data, and operations.",
    motivationRevenueMartech:
      "Revenue and MarTech lead connecting marketing, CRM, data, and operations.",
  },
  crm: {
    hasUsedHubSpot: false,
    summary: "Integrated CRM workflows via APIs; has not used HubSpot.",
  },
};

export type PersonaMotivation = keyof CandidateProfile["screening"];

const profileStore = new AsyncLocalStorage<CandidateProfile>();

/** Profile for the current run, or the internal seed when no workspace is installed. */
export function activeCandidate(): CandidateProfile {
  return profileStore.getStore() ?? internalCandidateProfile;
}

export function withCandidateProfile<T>(profile: CandidateProfile, fn: () => Promise<T>): Promise<T> {
  return profileStore.run(profile, fn);
}

/**
 * Reads follow the active workspace profile. Call sites keep `candidate.email`
 * and still see the buyer for this run.
 */
export const candidate: CandidateProfile = new Proxy(internalCandidateProfile, {
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
  const euLine = euCitizen && euCountry ? ` EU citizen (${euCountry}).` : "";
  const israelLine = sponsorshipIsrael
    ? " May require employer visa sponsorship for work in Israel."
    : " Authorized to work in Israel without employer visa sponsorship.";
  return `Holds ${passportList} passports.${euLine}${israelLine}`;
}

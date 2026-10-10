import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Buyer identity for forms, CV, and fit. Workspace `internal` is seeded from
 * `internalCandidateProfile`. A run installs another buyer's copy via `withCandidateProfile`.
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

/** Seed for workspace `internal` only. Not a product rule for every buyer. */
export const internalCandidateProfile: CandidateProfile = {
  firstName: "Or",
  lastName: "Shvartz",
  fullName: "Or Shvartz",
  email: "or.shvartz70@gmail.com",
  phone: {
    local: "0502186338",
    display: "050-218-6338",
    international: "+972502186338",
  },
  location: {
    city: "Petah Tikva",
    country: "Israel",
  },
  /**
   * Hybrid / on-site commute screening (Greenhouse etc.). Answered Yes only for offices
   * in our pursue geography — see location-eligibility (Central + Tel Aviv District metro).
   */
  workLocation: {
    willingToCommuteToEligibleOffices: true,
  },
  linkedin: "https://www.linkedin.com/in/or-shvartz-00b40b163/",
  github: "https://github.com/digitalab-creator",
  portfolio: {
    marketing: "https://digitalab.co.il/portfolio/?capability=performance",
    build: "https://digitalab.co.il/portfolio/?capability=build",
    automation: "https://digitalab.co.il/portfolio/?capability=automate",
  },
  workAuthorization: {
    israel: true,
    sponsorshipIsrael: false,
    euCitizen: true,
    euCountry: "Poland",
    passports: ["Israel", "Poland"],
  },
  noticePeriod: "1 week after signing",
  lastSalary: {
    amount: 25000,
    currency: "ILS",
    period: "month" as const,
    annualAmount: 300000,
  },
  salaryExpectation: {
    /** Lowest monthly figure we may enter on forms (role quotes stay above this). */
    minimum: 20000,
    maximum: 32000,
    currency: "ILS",
    period: "month" as const,
    /** Published-ad filtering only — not the number we quote on applications. */
    opportunityFilter: {
      excludeBelow: 18000,
      processingMinimum: 20000,
    },
  },
  languages: [
    { language: "Hebrew", level: "Native" },
    { language: "English", level: "Fluent" },
  ],
  /**
   * Confirmed by the candidate for application forms.
   * Dropdowns and platform checkboxes read this object. Do not copy the numbers elsewhere.
   */
  media: {
    ppcYears: 12,
    maxMonthlyBudgetIls: 1_500_000,
    /** Maps to “primary paid media focus” style dropdowns; forms read this, not ad-hoc facts. */
    primaryPaidMediaFocus: "Full-funnel growth (acquisition, CRO, and analytics)",
    platforms: [
      "Google",
      "Meta",
      "Taboola",
      "Outbrain",
      "X",
      "ChatGPT Ads",
      "LinkedIn",
      "Snapchat",
      "Traffic Junky",
      "Mantis",
      "Microsoft Ads",
    ],
  },
  /** Motivation snippets for opaque ATS fields (e.g. SmartRecruiters “human-reason”). Persona picks the line. */
  screening: {
    motivationTechnical:
      "Applied AI engineer focused on production engineering and demonstrated AI delivery (RAG, APIs, shipped product); excited to own end-to-end systems in production.",
    motivationMarketing:
      "Performance marketing lead (10+ years): paid acquisition, budget ownership, measurement, and results across Google, Meta, and full-funnel optimization.",
    motivationHybrid:
      "Revenue & MarTech lead connecting marketing, CRM, data, and operations — built and integrated CRM workflows, APIs, and attribution (not HubSpot).",
    motivationRevenueMartech:
      "Revenue & MarTech lead connecting marketing, CRM, data, and operations — built and integrated CRM workflows, APIs, and attribution (not HubSpot).",
  },
  /** Hard boundary for CV/job-fit — never claim tools the candidate has not used. */
  crm: {
    hasUsedHubSpot: false,
    summary:
      "Integrated multiple CRM platforms and built one custom CRM; has not used HubSpot.",
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
  const euLine = euCitizen ? ` EU citizen (${euCountry}).` : "";
  const israelLine = sponsorshipIsrael
    ? " May require employer visa sponsorship for work in Israel."
    : " Authorized to work in Israel without employer visa sponsorship.";
  return `Holds ${passportList} passports.${euLine}${israelLine}`;
}

import type { CandidateProfile } from "../config/candidate.js";

/** Fictional profile for unit tests only — never used in production runs. */
export const unitTestCandidateProfile: CandidateProfile = {
  firstName: "Alex",
  lastName: "Fixture",
  fullName: "Alex Fixture",
  email: "candidate.fixture@example.com",
  phone: {
    local: "0500000000",
    display: "050-000-0000",
    international: "+972500000000",
  },
  location: {
    city: "Ramat Gan",
    country: "Israel",
  },
  workLocation: {
    willingToCommuteToEligibleOffices: true,
  },
  linkedin: "https://www.linkedin.com/in/example-fixture",
  github: "https://github.com/example-fixture",
  portfolio: {
    marketing: "https://example.com/portfolio/marketing",
    build: "https://example.com/portfolio/build",
    automation: "https://example.com/portfolio/automation",
  },
  workAuthorization: {
    israel: true,
    sponsorshipIsrael: false,
    euCitizen: true,
    euCountry: "Poland",
    passports: ["Israel", "Poland"],
  },
  noticePeriod: "2 weeks",
  lastSalary: {
    amount: 25000,
    currency: "ILS",
    period: "month",
    annualAmount: 300000,
  },
  salaryExpectation: {
    minimum: 20000,
    maximum: 32000,
    currency: "ILS",
    period: "month",
    opportunityFilter: {
      excludeBelow: 18000,
      processingMinimum: 20000,
    },
  },
  languages: [
    { language: "Hebrew", level: "Native" },
    { language: "English", level: "Fluent" },
  ],
  media: {
    ppcYears: 12,
    maxMonthlyBudgetIls: 1_500_000,
    primaryPaidMediaFocus: "Full-funnel growth",
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
  screening: {
    motivationTechnical:
      "Applied AI engineer focused on production engineering and demonstrated AI delivery (RAG, APIs, shipped product).",
    motivationMarketing:
      "Performance marketing lead (10+ years): paid acquisition, budget ownership, measurement, and full-funnel optimization.",
    motivationHybrid: "Revenue & MarTech lead connecting marketing, CRM, data, and operations.",
    motivationRevenueMartech: "Revenue & MarTech lead connecting marketing, CRM, data, and operations.",
  },
  crm: {
    hasUsedHubSpot: false,
    summary: "Example CRM summary for tests.",
  },
};

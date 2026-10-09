/** Identity the user stated directly. Job facts live in the fact pool, not here. */
export const candidate = {
  firstName: "Or",
  lastName: "Redacted",
  fullName: "Example Operator",
  email: "redacted@example.com",
  phone: {
    local: "0000000000",
    display: "000-000-0000",
    international: "+10000000000",
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
  linkedin: "https://www.linkedin.com/in/redacted/",
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
    minimum: 21000,
    maximum: 32000,
    currency: "ILS",
    period: "month" as const,
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
} as const;

export type PersonaMotivation = keyof typeof candidate.screening;

/** Single source of truth for forms, facts, and LLM payloads about citizenship. */
export function workAuthorizationSummary(): string {
  const { passports, euCitizen, euCountry, sponsorshipIsrael } = candidate.workAuthorization;
  const passportList = passports.join(" and ");
  const euLine = euCitizen ? ` EU citizen (${euCountry}).` : "";
  const israelLine = sponsorshipIsrael
    ? " May require employer visa sponsorship for work in Israel."
    : " Authorized to work in Israel without employer visa sponsorship.";
  return `Holds ${passportList} passports.${euLine}${israelLine}`;
}

export const SALARY_MIN = candidate.salaryExpectation.minimum;
export const SALARY_MAX = candidate.salaryExpectation.maximum;

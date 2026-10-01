/** Identity the user stated directly. Job facts live in the fact pool, not here. */
export const candidate = {
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
    { language: "English", level: "Full professional proficiency" },
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
      "Applied AI engineer and product builder (RAG, automation, production systems); excited to ship growth-facing product and experiments at scale.",
    motivationMarketing:
      "Performance marketing and full-funnel growth lead (10+ years paid media); I combine acquisition, measurement, and CRO with technical automation.",
    motivationHybrid:
      "Applied AI product builder with 10+ years in performance marketing; pursuing roles that combine shipping product, experiments, and acquisition.",
  },
} as const;

export type PersonaMotivation = keyof typeof candidate.screening;

export const SALARY_MIN = candidate.salaryExpectation.minimum;
export const SALARY_MAX = candidate.salaryExpectation.maximum;

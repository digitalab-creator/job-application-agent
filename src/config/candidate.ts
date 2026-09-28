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
} as const;

export const SALARY_MIN = candidate.salaryExpectation.minimum;
export const SALARY_MAX = candidate.salaryExpectation.maximum;

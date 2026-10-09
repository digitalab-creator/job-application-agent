export type Persona = "technical" | "marketing" | "hybrid";

export type FactPersona = Persona | "both";

export type Fact = {
  id: string;
  roleId: string | null;
  text: string;
  tags: string[];
  personas: FactPersona[];
  verified: true;
};

export type RoleRecord = {
  id: string;
  company: string;
  start: string;
  end: string;
  titleVariants: string[];
  defaultTitle: Record<Persona, string>;
};

export type CvBullet = {
  factIds: string[];
  text: string;
};

export type CvRole = {
  roleId: string;
  title: string;
  bullets: CvBullet[];
};

export type PortfolioKey = "build" | "marketing" | "automation";

export type CvDocument = {
  headlineId: "tech-full" | "marketing-full";
  summary: string;
  summaryFactIds: string[];
  selectedSkills: string[];
  experience: CvRole[];
  educationFactIds: string[];
  /** When false, omit portfolio from the PDF header and leave portfolio form fields blank. */
  includePortfolio: boolean;
  portfolioKey?: PortfolioKey;
};

export type CvSource = "generated" | "static_fallback";

export type CvWording = "llm" | "verbatim";

export type ApplicationStatus =
  | "applied"
  | "closed"
  | "not_relevant"
  | "invalid_url"
  | "review"
  | "failed"
  | "quota_reached"
  | "budget_reached"
  | "already_submitted"
  | "location_ineligible"
  /** Tried auto-apply; captcha / login / account gate — human only, not a fixable Review. */
  | "manual_required";

export type AttemptOutcome =
  | "applied"
  | "manual_required"
  | "closed"
  | "no_suitable_replacement"
  | "not_relevant"
  | "location_ineligible"
  | "invalid_url"
  | "navigation_failed"
  | "form_not_detected"
  | "form_validation"
  | "cv_generation_failed"
  | "confirmation_not_detected"
  | "request_failed"
  | "quota_reached"
  | "budget_reached"
  | "already_submitted"
  | "dry_run"
  | "in_progress";

export type AttemptPipeline = {
  urlValidated: boolean;
  opened: boolean;
  recovered: boolean;
  fitPassed: boolean;
  cvGenerated: boolean;
  cvQualityPassed: boolean;
  submitted: boolean;
  confirmed: boolean;
};

export type ApplyRunSource =
  | "n8n_schedule"
  | "n8n_webhook"
  | "retry_batch"
  | "manual"
  | "native_schedule"
  | "native_manual";

export type ApplyAttemptRecord = {
  attemptId: string;
  startedAt: string;
  finishedAt: string;
  company: string;
  role: string;
  originalJobUrl: string;
  canonicalJobUrl?: string;
  cvPath?: string;
  outcome: AttemptOutcome;
  blocker?: string;
  submitted: boolean;
  confirmationDetected: boolean;
  pipeline: AttemptPipeline;
  notes: string;
  /** Paying customer / operator workspace. Default `internal`. */
  workspaceId?: string;
  runSource?: ApplyRunSource;
  runId?: string;
  batchId?: string;
  triggeredAt?: string;
};

export type AnswerRecord = {
  question: string;
  answer: string;
  source: string;
};

export type ApplicationResult = {
  attemptId?: string;
  status: ApplicationStatus;
  jobUrl: string;
  canonicalJobUrl?: string;
  cvUsed?: "technical" | "marketing";
  persona?: Persona;
  cvSource?: CvSource;
  cvWording?: CvWording;
  cvPath?: string;
  cvRelevanceScore?: number;
  factIds?: string[];
  ats?: string;
  submitted: boolean;
  confirmationDetected: boolean;
  appliedAt?: string;
  blocker?: string;
  notes: string;
  terminalOutcome?: AttemptOutcome;
  pipeline?: AttemptPipeline;
  recoveredFrom?: {
    originalRole: string;
    originalUrl: string;
    replacementRole: string;
  };
  screenshots?: string[];
  answers?: AnswerRecord[];
  /** Copy-paste fields + CV link for Google Sheet Manual rows. */
  manualFillGuide?: string;
  llmCostUsd?: number;
  quota?: {
    day: string;
    confirmed: number;
    maxAttempts: number;
    attempted: number;
    attemptsRemaining: number;
  };
  budget?: {
    day: string;
    month: string;
    limitIls: number;
    spentIls: number;
    remainingIls: number;
    daysRemaining: number;
    dailyBudgetIls: number;
    dailySpentIls: number;
    dailyRemainingIls: number;
    monthlyOpen: boolean;
    dailyOpen: boolean;
    open: boolean;
  };
};

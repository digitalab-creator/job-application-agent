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

export type CvDocument = {
  headlineId: "tech-full" | "marketing-full";
  summary: string;
  summaryFactIds: string[];
  selectedSkills: string[];
  experience: CvRole[];
  educationFactIds: string[];
};

export type CvSource = "generated" | "static_fallback";

export type CvWording = "llm" | "verbatim";

export type ApplicationStatus = "applied" | "closed" | "not_relevant" | "review" | "failed";

export type AnswerRecord = {
  question: string;
  answer: string;
  source: string;
};

export type ApplicationResult = {
  status: ApplicationStatus;
  jobUrl: string;
  canonicalJobUrl?: string;
  cvUsed?: "technical" | "marketing";
  persona?: Persona;
  cvSource?: CvSource;
  cvWording?: CvWording;
  cvPath?: string;
  factIds?: string[];
  ats?: string;
  submitted: boolean;
  confirmationDetected: boolean;
  appliedAt?: string;
  blocker?: string;
  notes: string;
  screenshots?: string[];
  answers?: AnswerRecord[];
};

import type { Persona } from "../models/types.js";

type PersonaDefaults = {
  headlineId: "tech-full" | "marketing-full";
  summaryFactId: string;
  skills: string[];
  roleFactIds: Record<string, string[]>;
  educationFactIds: string[];
};

const TECHNICAL_SKILLS = [
  "LangGraph",
  "LangChain",
  "RAG",
  "Semantic search",
  "pgvector",
  "OpenSearch",
  "Tool calling",
  "Grounded generation",
  "Python",
  "FastAPI",
  "Node.js",
  "TypeScript",
  "React",
  "REST APIs",
  "Microservices",
  "PostgreSQL",
  "Redis",
  "MariaDB",
  "Docker",
  "CI/CD",
  "Monitoring",
  "Cloud deployment",
  "LegalTech",
  "AdTech",
  "MarTech",
  "E-commerce",
  "Workflow automation",
];

const MARKETING_SKILLS = [
  "Google Ads",
  "Meta Ads",
  "TikTok Ads",
  "Microsoft Ads",
  "Media planning",
  "Budget pacing",
  "CPA reduction",
  "ROAS",
  "Experimentation",
  "Funnel analysis",
  "Conversion optimization",
  "GA4",
  "GTM",
  "Tracking architecture",
  "Attribution",
  "Dashboards",
  "Performance reporting",
  "APIs",
  "Internal tools",
  "AI-assisted analysis",
  "Workflow automation",
  "CRM integrations",
  "Marketing automation",
  "Webhooks",
];

export const personaDefaults: Record<Persona, PersonaDefaults> = {
  technical: {
    headlineId: "tech-full",
    summaryFactId: "summary-technical",
    skills: TECHNICAL_SKILLS,
    roleFactIds: {
      caseedge: ["caseedge-production", "caseedge-stack", "caseedge-entity-matching", "caseedge-forecasting"],
      boroda: ["boroda-platform", "boroda-adoption"],
      klogic: ["klogic-pipelines", "klogic-cellcom-tech"],
      fullpower: ["fullpower-build", "fullpower-combined"],
      independent: ["independent-agency", "independent-adtech"],
    },
    educationFactIds: ["edu-ml-stanford", "edu-hf"],
  },
  marketing: {
    headlineId: "marketing-full",
    summaryFactId: "summary-marketing",
    skills: MARKETING_SKILLS,
    roleFactIds: {
      caseedge: ["caseedge-advisory", "caseedge-campaigns", "caseedge-launched"],
      boroda: ["boroda-accounts", "boroda-watch-mkt", "boroda-cpa", "boroda-mentor"],
      klogic: ["klogic-cellcom-mkt", "klogic-workflows", "klogic-ai-implementation-lead", "klogic-enterprise"],
      fullpower: ["fullpower-paid", "fullpower-tracking", "fullpower-visibility"],
      independent: ["independent-acquisition", "independent-supervisor-agency", "independent-specialized"],
    },
    educationFactIds: [],
  },
  hybrid: {
    headlineId: "tech-full",
    summaryFactId: "summary-technical",
    skills: [
      "Python",
      "RAG",
      "APIs",
      "Microservices",
      "Google Ads",
      "GA4",
      "Workflow automation",
      "Docker",
      "Dashboards",
      "AI-assisted analysis",
      "CRM integrations",
      "Webhooks",
    ],
    roleFactIds: {
      caseedge: ["caseedge-production", "caseedge-stack", "caseedge-advisory"],
      boroda: ["boroda-platform", "boroda-accounts"],
      klogic: ["klogic-pipelines", "klogic-ai-implementation-lead", "klogic-cellcom-mkt"],
      fullpower: ["fullpower-build", "fullpower-tracking"],
      independent: ["independent-crm-built", "independent-crm-integrations", "independent-adtech"],
    },
    educationFactIds: ["edu-ml-stanford", "edu-hf"],
  },
};

export function choosePersona(role: string, category = ""): Persona | "needs_model" {
  const text = `${role} ${category}`.toLowerCase();
  const technical = /applied ai|ai engineer|llm|rag|backend|full stack|fullstack|automation engineer|ai architect|software engineer|ml engineer/;
  const marketing = /ppc|performance marketing|paid acquisition|user acquisition|growth manager|cro|martech|marketing automation|performance lead|paid ads/;
  const hybrid = /growth engineer|technical growth|martech engineer|ai growth|marketing technology/;
  if (hybrid.test(text)) {
    return "needs_model";
  }
  if (technical.test(text) && marketing.test(text)) {
    return "needs_model";
  }
  if (marketing.test(text)) {
    return "marketing";
  }
  if (technical.test(text)) {
    return "technical";
  }
  return "needs_model";
}

export type PortfolioKey = "build" | "marketing" | "automation";

export function portfolioFor(persona: Persona): PortfolioKey {
  if (persona === "marketing") {
    return "marketing";
  }
  if (persona === "hybrid") {
    return "automation";
  }
  return "build";
}

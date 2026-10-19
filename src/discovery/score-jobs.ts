import { z } from "zod";
import { env } from "../config/env.js";
import { completeJson } from "../llm/client.js";
import type { RawBoardJob } from "./scan-boards.js";
import { sheetCategoryFromDiscovery } from "./category-map.js";
import { resolveJobLocationVerdict } from "./resolve-location-eligibility.js";
import { getSearchPolicy } from "../config/search-policy-runtime.js";
import { CANONICAL_TRACKER_CATEGORIES } from "./tracker-category-weights.js";
import { log } from "../logging/logger.js";
import { uniqueKeyForUrl } from "./job-url-key.js";
import { specialistDiscoveryReason } from "./specialist-role.js";

export type DiscoveryScoreStats = {
  openingsIn: number;
  llmRowsParsed: number;
  llmParseFailed: boolean;
  llmRejected: number;
  locationRejected: number;
  accepted: number;
};

function discoveryScoreSystemPrompt(): string {
  const categories = CANONICAL_TRACKER_CATEGORIES.join(" | ");
  const policy = getSearchPolicy();
  const categoryHints = policy.categoryRows
    .filter((row) => row.included && row.keywords.length > 0)
    .map((row) => `${row.category}: ${row.keywords.join(", ")}`)
    .join("; ");
  const hintsLine = categoryHints
    ? `Search Config title/keyword hints per category: ${categoryHints}.`
    : "";
  return `You score job openings for Example Operator (AI engineer, full-stack, performance marketing, growth).
Return JSON only: {"jobs":[{"index":0,"matchScore":0,"category":"<sheet category>","whyItFits":"one sentence","relevant":true}]}
category MUST be exactly one of these sheet tracker categories: ${categories}
Do not collapse into generic AI/Growth/Hybrid labels.
Target mix follows Search Config policy ${policy.version}. ${hintsLine}
matchScore is 0-100. relevant=false when the role is clearly unrelated (pure sales, junior intern, unrelated ops).
relevant=false for roles that are clearly on-site only outside Israel (US/EU/Iceland/Poland etc.) unless the text explicitly allows remote work from Israel.
relevant=false for on-site roles outside Israel Central or Tel Aviv District (e.g. Haifa, Jerusalem only) unless remote is stated.
relevant=false when the title/snippet is clearly browser-extension SDK, client-side fraud/anti-bot R&D, or a specialist Go/Java/.NET role with no overlap to full-stack AI/product engineering.
Discovery only sees title and snippet — apply-time fit still rejects bad matches; prefer relevant=false over inflating matchScore for niche stacks.
Do not invent candidate facts. Base only on title and snippet.`;
}

/** Keep the sheet cell readable. */
const LOCATION_EVIDENCE_MAX_CHARS = 140;

const schema = z.object({
  jobs: z.array(z.object({
    index: z.number().int(),
    matchScore: z.number().min(0).max(100),
    category: z.string(),
    whyItFits: z.string(),
    relevant: z.boolean(),
  })),
});

export type ScoredDiscoveryJob = {
  uniqueKey: string;
  role: string;
  company: string;
  url: string;
  matchScore: number;
  category: string;
  whyItFits: string;
  source: string;
  /** Why the location gate passed (sheet "Location" column), e.g. "rules: metro:Tel Aviv". */
  location: string;
};

export async function scoreDiscoveryJobs(
  boardUrl: string,
  openings: RawBoardJob[],
  scoringBias: "marketing" | "balanced" = "balanced",
): Promise<{ jobs: ScoredDiscoveryJob[]; stats: DiscoveryScoreStats }> {
  const stats: DiscoveryScoreStats = {
    openingsIn: openings.length,
    llmRowsParsed: 0,
    llmParseFailed: false,
    llmRejected: 0,
    locationRejected: 0,
    accepted: 0,
  };
  if (openings.length === 0) {
    return { jobs: [], stats };
  }
  const company = companyFromBoardUrl(boardUrl);
  const payload = openings.map((job, index) => ({
    index,
    title: job.title,
    snippet: job.snippet,
    url: job.href,
  }));
  const biasLine = scoringBias === "marketing"
    ? "Queue is tech-heavy: label true growth/performance/PPC roles as Growth (not AI). Be strict on pure engineering roles."
    : "Balance AI and Growth labels honestly.";
  const raw = await completeJson(
    discoveryScoreSystemPrompt(),
    JSON.stringify({ company, scoringBias: biasLine, openings: payload, policyVersion: getSearchPolicy().version }),
    env.llmModel,
    "discovery",
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    stats.llmParseFailed = true;
    log("DISCOVERY_SCORE_PARSE_FAILED", {
      boardUrl,
      openings: openings.length,
      issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message),
    });
    return { jobs: [], stats };
  }
  stats.llmRowsParsed = parsed.data.jobs.length;
  const out: ScoredDiscoveryJob[] = [];
  for (const row of parsed.data.jobs) {
    const minScore = getSearchPolicy().discoveryMinMatchScore;
    if (!row.relevant || row.matchScore < minScore) {
      stats.llmRejected += 1;
      continue;
    }
    const opening = openings[row.index];
    if (!opening) {
      continue;
    }
    if (specialistDiscoveryReason(opening.title)) {
      continue;
    }
    const locationVerdict = await resolveJobLocationVerdict({
      title: opening.title,
      snippet: opening.snippet,
      url: opening.href,
    });
    if (!locationVerdict.eligible) {
      stats.locationRejected += 1;
      continue;
    }
    stats.accepted += 1;
    out.push({
      uniqueKey: uniqueKeyForUrl(opening.href),
      role: opening.title,
      company,
      url: opening.href,
      matchScore: Math.round(row.matchScore),
      category: sheetCategoryFromDiscovery(row.category),
      whyItFits: row.whyItFits,
      source: "n8n_discover",
      location: `${locationVerdict.source}: ${locationVerdict.reason}`.slice(0, LOCATION_EVIDENCE_MAX_CHARS),
    });
  }
  return { jobs: out, stats };
}

export { uniqueKeyForUrl } from "./job-url-key.js";

function companyFromBoardUrl(boardUrl: string): string {
  try {
    const parts = new URL(boardUrl).pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("jobs");
    if (idx >= 0 && parts[idx + 1]) {
      return parts[idx + 1].replace(/-/g, " ");
    }
  } catch {
    return "Unknown";
  }
  return "Unknown";
}

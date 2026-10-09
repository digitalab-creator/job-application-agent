import { z } from "zod";
import { env } from "../config/env.js";
import { completeJson } from "../llm/client.js";
import type { RawBoardJob } from "./scan-boards.js";
import { sheetCategoryFromDiscovery } from "./category-map.js";
import { resolveJobLocationVerdict } from "./resolve-location-eligibility.js";
import { uniqueKeyForUrl } from "./job-url-key.js";

const SYSTEM = `You score job openings for Example Operator (AI engineer, full-stack, performance marketing, growth).
Return JSON only: {"jobs":[{"index":0,"matchScore":0,"category":"AI|Growth|Hybrid|Other","whyItFits":"one sentence","relevant":true}]}
category: AI = engineering/product AI roles; Growth = marketing, PPC, growth, performance; Hybrid = mixed; Other = adjacent but still plausible.
Target mix over time: match the configured queue mix (default 50% AI / 50% Growth) — prefer labeling true growth/performance roles as Growth, not AI.
matchScore is 0-100. relevant=false when the role is clearly unrelated (pure sales, junior intern, unrelated ops).
relevant=false for roles that are clearly on-site only outside Israel (US/EU/Iceland/Poland etc.) unless the text explicitly allows remote work from Israel.
relevant=false for on-site roles outside Israel Central or Tel Aviv District (e.g. Haifa, Jerusalem only) unless remote is stated.
relevant=false when the title/snippet is clearly browser-extension SDK, client-side fraud/anti-bot R&D, or a specialist Go/Java/.NET role with no overlap to full-stack AI/product engineering.
Discovery only sees title and snippet — apply-time fit still rejects bad matches; prefer relevant=false over inflating matchScore for niche stacks.
Do not invent candidate facts. Base only on title and snippet.`;

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
): Promise<ScoredDiscoveryJob[]> {
  if (openings.length === 0) {
    return [];
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
  const raw = await completeJson(SYSTEM, JSON.stringify({ company, scoringBias: biasLine, openings: payload }), env.llmModel, "discovery");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  const out: ScoredDiscoveryJob[] = [];
  for (const row of parsed.data.jobs) {
    if (!row.relevant || row.matchScore < 55) {
      continue;
    }
    const opening = openings[row.index];
    if (!opening) {
      continue;
    }
    const locationVerdict = await resolveJobLocationVerdict({
      title: opening.title,
      snippet: opening.snippet,
      url: opening.href,
    });
    if (!locationVerdict.eligible) {
      continue;
    }
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
  return out;
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

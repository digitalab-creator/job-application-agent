import { z } from "zod";
import { env } from "../config/env.js";
import { completeJson } from "../llm/client.js";
import type { RawBoardJob } from "./scan-boards.js";
import { sheetCategoryFromDiscovery } from "./category-map.js";

const SYSTEM = `You score job openings for Or Shvartz (AI engineer, full-stack, performance marketing, growth).
Return JSON only: {"jobs":[{"index":0,"matchScore":0,"category":"AI|Growth|Hybrid|Other","whyItFits":"one sentence","relevant":true}]}
category: AI = engineering/product AI roles; Growth = marketing, PPC, growth, performance; Hybrid = mixed; Other = adjacent but still plausible.
Target mix over time: roughly 65% AI and 35% Growth — prefer labeling true growth/performance roles as Growth, not AI.
matchScore is 0-100. relevant=false when the role is clearly unrelated (pure sales, junior intern, unrelated ops).
Do not invent candidate facts. Base only on title and snippet.`;

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
};

export async function scoreDiscoveryJobs(
  boardUrl: string,
  openings: RawBoardJob[],
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
  const raw = await completeJson(SYSTEM, JSON.stringify({ company, openings: payload }), env.llmModel, "discovery");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  const out: ScoredDiscoveryJob[] = [];
  for (const row of parsed.data.jobs) {
    if (!row.relevant || row.matchScore < 55) {
      continue;
    }
    const job = openings[row.index];
    if (!job) {
      continue;
    }
    out.push({
      uniqueKey: uniqueKeyForUrl(job.href),
      role: job.title,
      company,
      url: job.href,
      matchScore: Math.round(row.matchScore),
      category: sheetCategoryFromDiscovery(row.category),
      whyItFits: row.whyItFits,
      source: "n8n_discover",
    });
  }
  return out;
}

export function uniqueKeyForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

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

import { z } from "zod";
import { env } from "../config/env.js";
import { getExcludedLocations } from "../application/exclude-location.js";
import { log } from "../logging/logger.js";
import { recordModelCost } from "../llm/cost-ledger.js";
import type { TokenUsage } from "../llm/prices.js";

const schema = z.object({
  city: z.string().optional(),
  region: z.string().optional(),
  workMode: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
});

export type LocationResearchFacts = z.infer<typeof schema>;

const SYSTEM = `You research where a job is located. Use web search when the posting text does not state city or remote/hybrid clearly.
Return JSON only: {"city":"","region":"","workMode":"remote|hybrid|onsite|unknown","address":"","country":"","notes":""}
workMode must reflect the employer's requirement for this role (not what a candidate might prefer).
country should be ISO-style name when known (e.g. Israel).
Do not invent an office address; leave fields empty if unknown.
Focus on the specific job URL when provided.`;

export async function researchJobLocationWithLlm(input: {
  title: string;
  snippet: string;
  url: string;
}): Promise<LocationResearchFacts> {
  const excluded = getExcludedLocations();
  const user = JSON.stringify({
    title: input.title,
    snippet: input.snippet.slice(0, 4000),
    url: input.url,
    policy: {
      accept: "remote anywhere in Israel OR on-site/hybrid in Israel Central District (Tel Aviv area, Petah Tikva, Ramat Gan, Holon, Rishon LeZion, Modi'in, etc.)",
      reject: `on-site only outside Central District (Haifa, Jerusalem, Netanya, Herzliya, etc. unless remote) and excluded cities: ${excluded.join(", ")}`,
    },
  });

  const useWebSearch = env.locationLookupWebSearch;
  if (useWebSearch) {
    const fromResponses = await tryResponsesWebSearch(SYSTEM, user);
    if (fromResponses) {
      return fromResponses;
    }
  }

  return researchFromTextOnly(SYSTEM, user);
}

async function tryResponsesWebSearch(system: string, user: string): Promise<LocationResearchFacts | null> {
  try {
    const response = await fetch(`${env.llmBaseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.llmApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.llmModel,
        tools: [{ type: "web_search_preview" }],
        input: [
          { role: "system", content: system },
          { role: "user", content: `${user}\nReturn JSON only.` },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      log("LOCATION_LLM_WEB_SEARCH_FAILED", { status: response.status, body: raw.slice(0, 200) });
      return null;
    }
    const parsed = JSON.parse(raw) as {
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = extractResponsesText(parsed);
    if (!text) {
      return null;
    }
    recordResponsesUsage(parsed.usage, "location_web_search");
    return parseLocationJson(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("LOCATION_LLM_WEB_SEARCH_FAILED", { message });
    return null;
  }
}

async function researchFromTextOnly(system: string, user: string): Promise<LocationResearchFacts> {
  const response = await fetch(`${env.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.llmModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Location LLM HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  const content = parsed.choices?.[0]?.message?.content ?? "{}";
  const usage: TokenUsage = {
    promptTokens: parsed.usage?.prompt_tokens ?? 0,
    cachedTokens: parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: parsed.usage?.completion_tokens ?? 0,
  };
  recordModelCost({ model: env.llmModel, purpose: "location_lookup", usage });
  return parseLocationJson(content);
}

function parseLocationJson(content: string): LocationResearchFacts {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  const raw = JSON.parse(trimmed) as unknown;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { workMode: "unknown", notes: "llm_parse_failed" };
  }
  return parsed.data;
}

function extractResponsesText(body: { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }): string {
  const chunks: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && part.text) {
          chunks.push(part.text);
        }
      }
    }
  }
  return chunks.join("\n").trim();
}

function recordResponsesUsage(
  usageBlock: { input_tokens?: number; output_tokens?: number } | undefined,
  purpose: string,
): void {
  const usage: TokenUsage = {
    promptTokens: usageBlock?.input_tokens ?? 0,
    cachedTokens: 0,
    completionTokens: usageBlock?.output_tokens ?? 0,
  };
  recordModelCost({ model: env.llmModel, purpose, usage });
}

export function factsToSnippet(facts: LocationResearchFacts): string {
  return [facts.workMode, facts.city, facts.region, facts.address, facts.country, facts.notes]
    .filter((part) => String(part || "").trim())
    .join(" ");
}

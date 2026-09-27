import { env } from "../config/env.js";
import { recordModelCost } from "./cost-ledger.js";
import { log } from "../logging/logger.js";
import type { TokenUsage } from "./prices.js";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
};

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export async function completeJson(
  system: string,
  user: string,
  model = env.llmModel,
  purpose = "llm",
): Promise<unknown> {
  try {
    return await callModel(model, system, user, purpose);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (model !== "gpt-5.6-luna" && /model|not found|does not exist/i.test(message)) {
      log("LLM_MODEL_FALLBACK", { from: model, to: "gpt-5.6-luna" });
      return callModel("gpt-5.6-luna", system, user, purpose);
    }
    throw error;
  }
}

async function callModel(model: string, system: string, user: string, purpose: string): Promise<unknown> {
  const response = await fetch(`${env.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
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
    throw new LlmError(`LLM HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  let parsed: ChatResponse;
  try {
    parsed = JSON.parse(raw) as ChatResponse;
  } catch (error) {
    throw new LlmError(`LLM response was not JSON: ${(error as Error).message}`);
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError("LLM returned an empty message");
  }
  const usage = tokenUsage(parsed);
  const cost = recordModelCost({ model, purpose, usage });
  log("LLM_COST", { model, purpose, usd: cost.usd, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
  return parseJsonContent(content);
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  return JSON.parse(trimmed) as unknown;
}

function tokenUsage(parsed: ChatResponse): TokenUsage {
  const promptTokens = parsed.usage?.prompt_tokens ?? 0;
  const cachedTokens = parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const completionTokens = parsed.usage?.completion_tokens ?? 0;
  return { promptTokens, cachedTokens, completionTokens };
}

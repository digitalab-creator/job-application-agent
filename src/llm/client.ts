import { env } from "../config/env.js";
import { log } from "../logging/logger.js";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export async function completeJson(system: string, user: string, model = env.llmModel): Promise<unknown> {
  try {
    return await callModel(model, system, user);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (model !== "gpt-5.6-luna" && /model|not found|does not exist/i.test(message)) {
      log("LLM_MODEL_FALLBACK", { from: model, to: "gpt-5.6-luna" });
      return callModel("gpt-5.6-luna", system, user);
    }
    throw error;
  }
}

async function callModel(model: string, system: string, user: string): Promise<unknown> {
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
  return parseJsonContent(content);
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  return JSON.parse(trimmed) as unknown;
}

export type ModelPrice = {
  input: number;
  cachedInput: number;
  output: number;
};

/** USD per 1 million tokens. OpenAI standard rates as of 2026-09-27. Override with LLM_PRICES_JSON. */
const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

export type TokenUsage = {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
};

export function priceForModel(model: string): ModelPrice {
  const overrides = readPriceOverrides();
  return overrides[model] ?? DEFAULT_PRICES[model] ?? DEFAULT_PRICES["gpt-5.6-terra"];
}

export function costUsd(model: string, usage: TokenUsage): number {
  const price = priceForModel(model);
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const fresh = Math.max(0, usage.promptTokens - cached);
  const usd = (fresh * price.input + cached * price.cachedInput + usage.completionTokens * price.output) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

function readPriceOverrides(): Record<string, ModelPrice> {
  const raw = process.env.LLM_PRICES_JSON?.trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelPrice>>;
    const prices: Record<string, ModelPrice> = {};
    for (const [model, value] of Object.entries(parsed)) {
      if (!value || typeof value.input !== "number" || typeof value.output !== "number") {
        continue;
      }
      prices[model] = {
        input: value.input,
        cachedInput: typeof value.cachedInput === "number" ? value.cachedInput : value.input,
        output: value.output,
      };
    }
    return prices;
  } catch {
    return {};
  }
}

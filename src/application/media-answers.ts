/**
 * Turns the candidate media profile into the option a form actually offers.
 * The profile stores the real number. Each site stores a bucket ("5+", "₪600,000+").
 */

export type Range = { min: number; max: number };

export type PlatformPlan = {
  check: string[];
  otherText: string;
};

const PLATFORM_TOKENS: { id: string; tokens: string[] }[] = [
  { id: "google", tokens: ["google"] },
  { id: "meta", tokens: ["meta", "facebook", "instagram"] },
  { id: "tiktok", tokens: ["tiktok"] },
  { id: "taboola", tokens: ["taboola"] },
  { id: "outbrain", tokens: ["outbrain"] },
  { id: "linkedin", tokens: ["linkedin"] },
  { id: "snapchat", tokens: ["snapchat"] },
  { id: "traffic junky", tokens: ["traffic junky", "trafficjunky"] },
  { id: "mantis", tokens: ["mantis"] },
  { id: "chatgpt ads", tokens: ["chatgpt", "chatgpt ads"] },
  { id: "x", tokens: ["x", "twitter"] },
  { id: "microsoft ads", tokens: ["microsoft ads", "bing", "microsoft advertising"] },
];

export function pickYearsOption(options: string[], years: number): string | null {
  return pickTightest(options, years, parseYearBucket);
}

export function pickBudgetOption(options: string[], monthlyIls: number): string | null {
  return pickTightest(options, monthlyIls, parseMoneyRange);
}

export function isPlatformQuestion(label: string, options: string[]): boolean {
  if (/platform|ppc|paid media|ad channel/i.test(label)) {
    return true;
  }
  const hits = options.filter((option) => /^(google|meta|facebook|tiktok|taboola|outbrain|bing|linkedin)$/i.test(option.trim())).length;
  return hits >= 2;
}

export function matchPlatforms(options: string[], platforms: readonly string[]): PlatformPlan {
  const realOptions = options.filter((option) => !/^other$/i.test(option.trim()));
  const matchedIds = new Set<string>();
  const check: string[] = [];
  for (const option of realOptions) {
    for (const platform of platforms) {
      const id = canonicalId(platform);
      if (optionMatchesPlatform(option, id)) {
        check.push(option);
        matchedIds.add(id);
        break;
      }
    }
  }
  const unmatched = platforms.filter((platform) => !matchedIds.has(canonicalId(platform)));
  const otherOption = options.find((option) => /^other$/i.test(option.trim()));
  if (unmatched.length > 0 && otherOption) {
    check.push(otherOption);
  }
  return { check, otherText: unmatched.join(", ") };
}

function pickTightest(options: string[], value: number, parse: (option: string) => Range | null): string | null {
  const fits = options
    .map((option) => ({ option, range: parse(option) }))
    .filter((item): item is { option: string; range: Range } => item.range !== null && value >= item.range.min && value <= item.range.max);
  if (fits.length === 0) {
    const minimumBuckets = options
      .map((option) => ({ option, range: parse(option) }))
      .filter((item): item is { option: string; range: Range } => item.range !== null && value >= item.range.min);
    if (minimumBuckets.length > 0) {
      minimumBuckets.sort((left, right) => right.range.min - left.range.min);
      return minimumBuckets[0]?.option ?? null;
    }
    return null;
  }
  fits.sort((left, right) => rangeWidth(left.range) - rangeWidth(right.range));
  return fits[0]?.option ?? null;
}

function parseYearBucket(option: string): Range | null {
  const text = option.toLowerCase().replace(/[–—]/g, "-");
  const less = text.match(/less than\s+(\d+(?:\.\d+)?)/);
  if (less?.[1]) {
    return { min: 0, max: Number(less[1]) - 0.001 };
  }
  const plus = text.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus?.[1]) {
    return { min: Number(plus[1]), max: Number.POSITIVE_INFINITY };
  }
  const range = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (range?.[1] && range[2]) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }
  return null;
}

function parseMoneyRange(option: string): Range | null {
  const nums = [...option.matchAll(/\d[\d,]*/g)]
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter((value) => value >= 1000);
  if (nums.length === 0) {
    return null;
  }
  const min = nums[0];
  if (min === undefined) {
    return null;
  }
  if (/\+/.test(option) && nums.length === 1) {
    return { min, max: Number.POSITIVE_INFINITY };
  }
  if (/less than|under|up to/i.test(option) && nums.length === 1) {
    return { min: 0, max: min };
  }
  const max = nums[1];
  if (max === undefined) {
    return { min, max: min };
  }
  return { min, max };
}

function rangeWidth(range: Range): number {
  return range.max - range.min;
}

function canonicalId(name: string): string {
  const norm = name.toLowerCase().trim();
  for (const entry of PLATFORM_TOKENS) {
    if (entry.id === norm || entry.tokens.some((token) => sameToken(norm, token))) {
      return entry.id;
    }
  }
  return norm;
}

function optionMatchesPlatform(option: string, platformId: string): boolean {
  const entry = PLATFORM_TOKENS.find((item) => item.id === platformId);
  const tokens = entry?.tokens ?? [platformId];
  return tokens.some((token) => sameToken(option, token));
}

function sameToken(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

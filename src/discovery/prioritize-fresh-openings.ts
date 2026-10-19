import type { SearchPolicy } from "../config/search-policy.js";
import type { RawBoardJob } from "./scan-boards.js";

function keywordTokens(policy: SearchPolicy): string[] {
  const tokens = new Set<string>();
  for (const row of policy.categoryRows) {
    if (!row.included) {
      continue;
    }
    for (const keyword of row.keywords) {
      const normalized = keyword.trim().toLowerCase();
      if (normalized.length >= 3) {
        tokens.add(normalized);
      }
    }
  }
  return [...tokens];
}

function titleKeywordScore(title: string, snippet: string, keywords: string[]): number {
  const haystack = `${title} ${snippet}`.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      score += keyword.length >= 8 ? 3 : 2;
    }
  }
  if (/\b(engineer|developer|architect|llm|genai|ml|data platform|full[- ]stack|growth)\b/i.test(title)) {
    score += 2;
  }
  if (/\b(account executive|sales|recruiter|intern\b|customer success)\b/i.test(title)) {
    score -= 4;
  }
  return score;
}

/**
 * Board APIs often list sales roles first. Prefer openings that match Search Config keywords
 * before the per-board LLM cap so discovery budget is not spent on obviously irrelevant titles.
 */
export function prioritizeFreshOpeningsForScoring(
  openings: RawBoardJob[],
  policy: SearchPolicy,
): RawBoardJob[] {
  if (openings.length <= 1) {
    return openings;
  }
  const keywords = keywordTokens(policy);
  if (keywords.length === 0) {
    return openings;
  }
  return [...openings].sort((a, b) => {
    const scoreB = titleKeywordScore(b.title, b.snippet, keywords);
    const scoreA = titleKeywordScore(a.title, a.snippet, keywords);
    return scoreB - scoreA;
  });
}

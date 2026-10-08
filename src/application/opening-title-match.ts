import type { ListedJob } from "./openings.js";

const STOP_WORDS = new Set(["and", "the", "for", "of", "in", "at", "to", "a", "an", "or"]);

/** Keywords from the sheet role title (length > 2, not stop words). */
export function roleKeywords(targetRole: string): string[] {
  return targetRole
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Score how well a listing title matches the target role (higher = better).
 * Used before LLM listing choice so "Growth Engineering Lead" beats unrelated growth-ish roles.
 */
export function scoreOpeningTitle(targetRole: string, openingTitle: string): number {
  const keywords = roleKeywords(targetRole);
  if (keywords.length === 0) {
    return 0;
  }
  const title = openingTitle.toLowerCase();
  let score = 0;
  for (const word of keywords) {
    if (titleHasRoleKeyword(title, word)) {
      score += 1;
    }
  }
  const normalizedTarget = targetRole.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedTitle = openingTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalizedTarget.length > 8 && normalizedTitle.includes(normalizedTarget)) {
    score += keywords.length + 2;
  } else if (keywords.length >= 2) {
    const phrase = keywords.slice(0, Math.min(3, keywords.length)).join(" ");
    if (phrase.length > 6 && normalizedTitle.includes(phrase)) {
      score += 2;
    }
  }
  return score;
}

function titleHasRoleKeyword(titleLower: string, word: string): boolean {
  if (titleLower.includes(word)) {
    return true;
  }
  if (word === "engineering" && /\bengineer/.test(titleLower)) {
    return true;
  }
  if (word === "engineer" && /\b(engineer|engineering)\b/.test(titleLower)) {
    return true;
  }
  return false;
}

/** Title score required before opening a different role from a careers hub than the sheet row. */
export function minTitleScoreForSubstitution(targetRole: string): number {
  const keywords = roleKeywords(targetRole);
  if (keywords.length === 0) {
    return 999;
  }
  const relaxed = Math.max(2, Math.ceil(keywords.length * 0.66));
  const highBar = Math.ceil(keywords.length * 0.85);
  return Math.min(keywords.length, Math.max(relaxed, highBar));
}

export function titleMatchDetail(targetRole: string, openingTitle: string): { score: number; minRequired: number; highConfidence: boolean } {
  const minRequired = minTitleScoreForSubstitution(targetRole);
  const score = scoreOpeningTitle(targetRole, openingTitle);
  return {
    score,
    minRequired,
    highConfidence: score >= minRequired,
  };
}

export function isHighConfidenceTitleMatch(targetRole: string, openingTitle: string): boolean {
  return titleMatchDetail(targetRole, openingTitle).highConfidence;
}

export function bestScoredOpening(targetRole: string, openings: ListedJob[]): ListedJob | null {
  let best: { job: ListedJob; score: number } | null = null;
  for (const job of openings) {
    const score = scoreOpeningTitle(targetRole, job.title);
    if (!best || score > best.score) {
      best = { job, score };
    }
  }
  const minScore = minTitleScoreForSubstitution(targetRole);
  if (!best || best.score < minScore) {
    return null;
  }
  return best.job;
}

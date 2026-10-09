import { normalizeTrackerCategory } from "./tracker-categories.js";
import { TRACKER_CATEGORY_TARGET_SHARE } from "./tracker-category-weights.js";

/** Map discovery LLM labels to the Google Sheet Category column (30-day tracker categories). */
export function sheetCategoryFromDiscovery(label: string): string {
  const trimmed = label.trim();
  if (TRACKER_CATEGORY_TARGET_SHARE.has(trimmed)) {
    return trimmed;
  }
  const key = trimmed.toLowerCase();
  if (key === "growth" || key.includes("growth marketing") || key.includes("performance marketing") || key.includes("ppc")) {
    return normalizeTrackerCategory("Performance Marketing Leadership");
  }
  if (key.includes("revops") || key.includes("revenue") || key.includes("gtm") || key === "hybrid") {
    return normalizeTrackerCategory("Revenue Systems");
  }
  if (key.includes("martech") || key.includes("marketing tech") || key.includes("marketing operations") || key.includes("marketing automation")) {
    return normalizeTrackerCategory("Marketing Technology");
  }
  if (key.includes("analytics") || key.includes("cro") || key.includes("tracking")) {
    return normalizeTrackerCategory("Analytics & CRO");
  }
  if (key.includes("solutions") && (key.includes("ai") || key.includes("implementation"))) {
    return normalizeTrackerCategory("AI Solutions");
  }
  if (key === "ai" || key.includes("applied ai") || key.includes("llm") || key.includes("backend")) {
    return normalizeTrackerCategory("Applied AI");
  }
  if (key === "other") {
    return normalizeTrackerCategory("AI Solutions");
  }
  if (/marketing|ppc|performance|paid acquisition/i.test(label)) {
    return normalizeTrackerCategory("Performance Marketing Leadership");
  }
  if (/growth/i.test(label)) {
    return normalizeTrackerCategory("Performance Marketing Leadership");
  }
  return normalizeTrackerCategory("Applied AI");
}

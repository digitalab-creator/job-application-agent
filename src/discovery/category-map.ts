/** Map discovery LLM labels to the Google Sheet Category column. */
export function sheetCategoryFromDiscovery(label: string): string {
  const key = label.trim().toLowerCase();
  if (key === "growth" || key.includes("growth marketing") || key.includes("performance")) {
    return "Growth Marketing";
  }
  if (key === "hybrid") {
    return "AI Product";
  }
  if (key === "ai" || key.includes("applied ai")) {
    return "Applied AI";
  }
  if (key === "other") {
    return "AI Solutions";
  }
  if (/growth/i.test(label)) {
    return "Growth Marketing";
  }
  if (/marketing|ppc|performance/i.test(label)) {
    return "Performance Marketing Leadership";
  }
  return "Applied AI";
}

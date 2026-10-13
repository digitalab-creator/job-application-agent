/** When apply finds zero jobs but daily budget remains, whether to stop or run another discover cycle. */
export function shouldStopAfterEmptyApply(input: {
  dailyBudgetOpen: boolean;
  /** `added` from the most recent discover in this pipeline run, or null if none yet. */
  lastDiscoverAdded: number | null;
  automatableEmployment: number;
}): { stop: true; reason: string } | { stop: false } {
  if (!input.dailyBudgetOpen) {
    return { stop: true, reason: "daily_budget_spent" };
  }
  if (input.automatableEmployment > 0) {
    return { stop: true, reason: "automatable_jobs_remain_unpicked" };
  }
  if (input.lastDiscoverAdded === 0) {
    return { stop: true, reason: "discover_added_zero" };
  }
  return { stop: false };
}

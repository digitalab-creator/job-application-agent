/** Confirmed employer applications per Jerusalem calendar day (business KPI). */
export function dailyConfirmedApplicationsTarget(): number {
  const parsed = Number(process.env.DAILY_CONFIRMED_APPLICATIONS_TARGET ?? "10");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 10;
  }
  return Math.floor(parsed);
}

export function dailyApplyMaxBatchesPerRun(): number {
  const parsed = Number(process.env.DAILY_APPLY_MAX_BATCHES_PER_RUN ?? "6");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 6;
  }
  return Math.floor(parsed);
}

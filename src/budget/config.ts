export function monthlyFixedCostIls(): number {
  const parsed = Number(process.env.MONTHLY_FIXED_COST_ILS ?? "150");
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 150;
  }
  return Math.round(parsed * 100) / 100;
}

export function usdIlsRate(): number {
  const parsed = Number(process.env.USD_ILS_RATE ?? "3.65");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3.65;
  }
  return parsed;
}

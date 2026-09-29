/**
 * Daily apply queue gate. Same rule as n8n Pick Jobs `okUrl`.
 * Any real http(s) job page is attempted. Known junk links are skipped.
 * A failed apply stays on the sheet as Review so we can tighten that site later.
 */
export function isAutomatableApplyUrl(url: string): boolean {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) {
    return false;
  }
  if (u.toLowerCase().includes("/jobs/stampli/") && u.toLowerCase().includes("0b.273")) {
    return false;
  }
  if (/^https:\/\/apply\.workable\.com\/comeet\//i.test(u)) {
    return false;
  }
  return true;
}

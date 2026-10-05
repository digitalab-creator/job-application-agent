/**
 * Daily apply queue gate. Same rule as n8n Pick Jobs `okUrl`.
 * Any real http(s) job page is attempted. Known junk links are skipped.
 * A failed apply stays on the sheet as Review so we can tighten that site later.
 */
export function isAutomatableApplyUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }
  const u = parsed.toString().toLowerCase();
  if (u.includes("/jobs/stampli/") && u.includes("0b.273")) {
    return false;
  }
  if (/^https:\/\/apply\.workable\.com\/comeet\//i.test(u)) {
    return false;
  }
  return true;
}

/** Validate before any Playwright navigation. The browser must never receive malformed input. */
export function parseHttpUrl(value: string): URL | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

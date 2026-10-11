/**
 * Broken sheet placeholders — valid HTTP, but not a real job posting path.
 * SSOT for denylist; ats-capability imports this too.
 */
export function isKnownBlockedApplyUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }
  const href = parsed.toString();
  if (/^https:\/\/apply\.workable\.com\/comeet\//i.test(href)) {
    return true;
  }
  // Stampli junk cell: team id then position id with no role slug in between.
  if (/\/jobs\/stampli\/[^/]+\/0b\.273\/?$/i.test(parsed.pathname)) {
    return true;
  }
  return false;
}

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
  if (isKnownBlockedApplyUrl(parsed.toString())) {
    return false;
  }
  return true;
}

/** Pull the first http(s) URL from a sheet cell (trailing notes, Hebrew text, etc.). */
export function extractHttpUrlFromCell(value: string): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (match) {
    const candidate = match[0].replace(/[.,;]+$/, "");
    const parsed = parseHttpUrl(candidate);
    if (parsed) {
      return parsed.toString();
    }
  }
  const direct = parseHttpUrl(trimmed);
  return direct ? direct.toString() : null;
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

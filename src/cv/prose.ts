/** Non-breaking hyphen — keeps compounds on one line in Chromium PDF. */
const NBH = "\u2011";

/** Collapsed or spaced variants → canonical hyphenated form (from baseline CV wording). */
const CANONICAL_COMPOUNDS: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /business\s*domain/gi, canonical: "business-domain" },
  { pattern: /end\s*to\s*end/gi, canonical: "end-to-end" },
  { pattern: /endto\s*-?\s*end/gi, canonical: "end-to-end" },
  { pattern: /paid\s*media/gi, canonical: "paid-media" },
  { pattern: /micro\s*service/gi, canonical: "microservice" },
  { pattern: /semantic\s*search/gi, canonical: "semantic search" },
  { pattern: /go\s*to\s*market/gi, canonical: "go-to-market" },
  { pattern: /full\s*stack/gi, canonical: "full-stack" },
  { pattern: /cost\s*per\s*conversion/gi, canonical: "cost per conversion" },
];

/** After canonicalization, lock hyphens inside these tokens for PDF layout. */
const HYPHEN_LOCK_TERMS = [
  "business-domain",
  "end-to-end",
  "paid-media",
  "go-to-market",
  "full-stack",
  "legal-document",
  "AI-assisted",
  "B2B",
];

export function polishCvText(text: string): string {
  let out = text.trim();
  for (const { pattern, canonical } of CANONICAL_COMPOUNDS) {
    out = out.replace(pattern, canonical);
  }
  for (const term of HYPHEN_LOCK_TERMS) {
    const locked = term.replace(/-/g, NBH);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "\\-");
    out = out.replace(new RegExp(escaped, "gi"), locked);
  }
  return out;
}

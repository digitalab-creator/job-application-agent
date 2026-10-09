/**
 * Match a decision value (e.g. "No") to an ATS option label without false positives
 * such as "Yes, I need visa sponsorship" matching "No" via substring "no" in "sponsorship".
 */
export function matchFieldOption(options: string[], value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || options.length === 0) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const exact = options.find((option) => option.trim().toLowerCase() === lower);
  if (exact) {
    return exact;
  }
  if (lower === "yes" || lower === "no") {
    const prefixRe = lower === "yes" ? /^yes\b/i : /^no\b/i;
    const byPrefix = options.find((option) => prefixRe.test(option.trim()));
    if (byPrefix) {
      return byPrefix;
    }
    if (lower === "yes") {
      const hebrewYes = options.find((option) => /^כן/.test(option.trim()));
      if (hebrewYes) {
        return hebrewYes;
      }
    }
    if (lower === "no") {
      const hebrewNo = options.find((option) => /^לא/.test(option.trim()));
      if (hebrewNo) {
        return hebrewNo;
      }
    }
    return null;
  }
  const partial = options.find((option) => option.toLowerCase().includes(lower));
  return partial ?? null;
}

export function matchFieldOptionIndex(options: string[], value: string): number {
  const match = matchFieldOption(options, value);
  if (!match) {
    return -1;
  }
  return options.findIndex((option) => option === match);
}

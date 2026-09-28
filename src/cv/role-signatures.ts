/**
 * Phrases that only belong under one employer section on the CV.
 * Catches swapped bullets even when factIds are wrong or stale.
 */
export const ROLE_CONTENT_SIGNATURES: Array<{ pattern: RegExp; roleId: string; label: string }> = [
  { pattern: /entity[- ]?matching/i, roleId: "caseedge", label: "entity-matching metrics" },
  { pattern: /inventory forecasting/i, roleId: "caseedge", label: "inventory forecasting advisory" },
  { pattern: /legal[- ]document intelligence/i, roleId: "caseedge", label: "CaseEdge product" },
  { pattern: /ROI Me\s*\/\s*Budget Watch/i, roleId: "boroda", label: "ROI Me / Budget Watch" },
  { pattern: /seven of eight accounts/i, roleId: "boroda", label: "seven of eight accounts" },
  { pattern: /Cellcom(?:'s)?\s+PPC/i, roleId: "klogic", label: "Cellcom PPC" },
  { pattern: /Nir Dovdevani/i, roleId: "independent", label: "Nir Dovdevani project" },
  { pattern: /six markets/i, roleId: "independent", label: "six markets cybersecurity" },
];

export function roleSignatureErrors(roleId: string, text: string, bulletLabel: string): string[] {
  const errors: string[] = [];
  for (const sig of ROLE_CONTENT_SIGNATURES) {
    if (sig.roleId === roleId) {
      continue;
    }
    if (sig.pattern.test(text)) {
      errors.push(
        `${bulletLabel} mentions ${sig.label}, which must appear only under ${sig.roleId}, not ${roleId}.`,
      );
    }
  }
  return errors;
}

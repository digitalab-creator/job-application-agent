/** Display dates on the CV as years only (e.g. 2025–present), not month names or 2025–2025. */
export function formatRoleDateRange(start: string, end: string): string {
  const from = formatRoleDate(start);
  const to = formatRoleDate(end);
  if (from === to) {
    return from;
  }
  return `${from}–${to}`;
}

export function formatRoleDate(value: string): string {
  const trimmed = value.trim();
  if (/^present$/i.test(trimmed)) {
    return "present";
  }
  const monthYear = trimmed.match(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i);
  if (monthYear) {
    return monthYear[1];
  }
  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) {
    return yearOnly[1];
  }
  return trimmed;
}

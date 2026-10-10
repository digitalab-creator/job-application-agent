const TZ = "Asia/Jerusalem";

/** Calendar day in Asia/Jerusalem as YYYY-MM-DD. */
export function jerusalemDayString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);
}

export function instantOnJerusalemDay(iso: string, day: string): boolean {
  if (!iso) {
    return false;
  }
  try {
    const dt = new Date(iso.replace("Z", "+00:00"));
    if (Number.isNaN(dt.getTime())) {
      return false;
    }
    return jerusalemDayString(dt) === day;
  } catch {
    return false;
  }
}

export function localScheduleParts(timeZone: string, date = new Date()): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      bag[part.type] = part.value;
    }
  }
  const dateStr = `${bag.year}-${bag.month}-${bag.day}`;
  const hour = Number(bag.hour);
  return { date: dateStr, hour: Number.isFinite(hour) ? hour : -1 };
}

export function scheduleSlotKey(
  kind: "apply" | "discover" | "outcome",
  timeZone: string,
  date = new Date(),
): string {
  const { date: d, hour } = localScheduleParts(timeZone, date);
  return `${kind}:${d}:${hour}`;
}

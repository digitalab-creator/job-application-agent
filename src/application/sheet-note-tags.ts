/** Parse `key=value` tags embedded in sheet Notes (same convention as job-finder). */

export function readNoteTag(notes: string, key: string): string {
  const pattern = new RegExp(`(?:^|\\n)${escapeRegExp(key)}=([^\\n]+)`, "i");
  const match = String(notes || "").match(pattern);
  return match?.[1]?.trim() ?? "";
}

export function setNoteTag(notes: string, key: string, value: string | number): string {
  const lines = String(notes || "")
    .split("\n")
    .filter((line) => !new RegExp(`^${escapeRegExp(key)}=`, "i").test(line.trim()));
  const trimmed = String(value ?? "").trim();
  if (trimmed) {
    lines.unshift(`${key}=${trimmed}`);
  }
  return lines.join("\n").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SENSITIVE_KEY = /token|secret|password|refresh|enc|authorization|cookie|api[_-]?key|cvpath|cv_path|profile_json/i;

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string" && value.length > 2000) {
    return `${value.slice(0, 2000)}…[truncated]`;
  }
  return value;
}

export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactRecord(value as Record<string, unknown>);
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === "object"
          ? redactRecord(item as Record<string, unknown>)
          : redactValue(key, item),
      );
      continue;
    }
    out[key] = redactValue(key, value);
  }
  return out;
}

export function cvPathForObservability(cvPath: string | undefined): string | undefined {
  if (!cvPath?.trim()) {
    return undefined;
  }
  const parts = cvPath.replace(/\\/g, "/").split("/");
  const base = parts[parts.length - 1] ?? cvPath;
  return `generated-cv/${base}`;
}

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { redactRecord } from "./redact.js";

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]+\b/g,
  /\bGOCSPX-[A-Za-z0-9_-]+\b/g,
];

export function redactLogLine(line: string): string {
  let out = line;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

export function tailJsonlByAttempt(
  filePath: string,
  attemptId: string,
  limit: number,
): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const bounded = Math.min(Math.max(1, limit), 200);
  const lines = fs.readFileSync(filePath, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  const hits: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (!line.includes(attemptId)) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      hits.push(redactRecord(parsed));
    } catch {
      hits.push({ raw: redactLogLine(line).slice(0, 500) });
    }
    if (hits.length >= bounded) {
      break;
    }
  }
  return hits;
}

export function filterDockerLogs(options: {
  container: string;
  sinceMinutes: number;
  attemptId?: string;
  event?: string;
  limit: number;
}): { lines: string[]; source: string } {
  const bounded = Math.min(Math.max(1, options.limit), 200);
  const args = [
    "logs",
    "--since",
    `${Math.min(Math.max(1, options.sinceMinutes), 24 * 60)}m`,
    "--tail",
    String(bounded * 3),
    options.container,
  ];
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 15_000 });
  if (result.error || result.status !== 0) {
    return { lines: [], source: "docker_unavailable" };
  }
  const needleAttempt = options.attemptId?.trim();
  const needleEvent = options.event?.trim();
  const lines = (result.stdout ?? "")
    .split("\n")
    .map((line) => redactLogLine(line.trim()))
    .filter(Boolean)
    .filter((line) => {
      if (needleAttempt && !line.includes(needleAttempt)) {
        return false;
      }
      if (needleEvent && !line.includes(needleEvent)) {
        return false;
      }
      return true;
    })
    .slice(-bounded);
  return { lines, source: "docker" };
}

export type DockerLogEvent = {
  ts: string | null;
  message: string;
  attemptId?: string;
  event?: string;
};

export function collectDockerLogEvents(options: {
  container: string;
  sinceMinutes: number;
  attemptId?: string;
  event?: string;
  limit: number;
}): { events: DockerLogEvent[]; source: string } {
  const raw = filterDockerLogs(options);
  const events: DockerLogEvent[] = raw.lines.map((line) => {
    let ts: string | null = null;
    let message = line;
    const jsonStart = line.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
        if (typeof parsed.ts === "string") {
          ts = parsed.ts;
        }
        if (typeof parsed.event === "string") {
          message = `${parsed.event} ${JSON.stringify(parsed)}`.slice(0, 800);
        }
      } catch {
        // keep raw line
      }
    }
    return {
      ts,
      message: message.slice(0, 800),
      attemptId: options.attemptId,
      event: options.event,
    };
  });
  return { events, source: raw.source };
}

export function summarizeAttemptErrors(attemptRows: Array<{ outcome?: string; blocker?: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of attemptRows) {
    const key = row.blocker || row.outcome || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25));
}

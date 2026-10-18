import { spawnSync } from "node:child_process";
import fs from "node:fs";

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]+\b/g,
];

function redactLogLine(line: string): string {
  let out = line;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

function stripDockerStreamFrames(raw: Buffer): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < raw.length) {
    if (i + 8 > raw.length) {
      break;
    }
    const size = raw.readUInt32BE(i + 4);
    i += 8;
    if (size <= 0 || i + size > raw.length) {
      break;
    }
    const chunk = raw.subarray(i, i + size).toString("utf8");
    i += size;
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) {
        lines.push(trimmed);
      }
    }
  }
  if (lines.length === 0) {
    const text = raw.toString("utf8").trim();
    if (text) {
      return text.split("\n").map((line) => line.trim()).filter(Boolean);
    }
  }
  return lines;
}

function dockerSocketPath(): string | null {
  const socket = process.env.DOCKER_SOCKET_PATH?.trim() || "/var/run/docker.sock";
  return fs.existsSync(socket) ? socket : null;
}

function fetchRawDockerLogs(container: string, sinceMinutes: number, tail: number): Buffer | null {
  const socket = dockerSocketPath();
  if (!socket) {
    return null;
  }
  const sinceSec = Math.min(Math.max(1, sinceMinutes), 24 * 60) * 60;
  const url = `http://localhost/containers/${encodeURIComponent(container)}/logs?stdout=1&stderr=1&timestamps=0&since=${sinceSec}&tail=${tail}`;
  const result = spawnSync("curl", ["-sS", "--unix-socket", socket, url], {
    encoding: "buffer",
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout;
}

export function collectGatewayDockerLogEvents(options: {
  container: string;
  sinceMinutes: number;
  attemptId?: string;
  event?: string;
  limit: number;
}): { events: Array<{ ts: string | null; message: string }>; source: string } {
  const bounded = Math.min(Math.max(1, options.limit), 200);
  const raw = fetchRawDockerLogs(options.container, options.sinceMinutes, bounded * 3);
  if (!raw) {
    return { events: [], source: "docker_unavailable" };
  }
  const needleAttempt = options.attemptId?.trim();
  const needleEvent = options.event?.trim();
  const lines = stripDockerStreamFrames(raw)
    .map((line) => redactLogLine(line))
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
  const events = lines.map((line) => {
    let ts: string | null = null;
    const jsonStart = line.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
        if (typeof parsed.ts === "string") {
          ts = parsed.ts;
        }
      } catch {
        // keep raw
      }
    }
    return { ts, message: line.slice(0, 800) };
  });
  return { events, source: "docker" };
}

import fs from "node:fs";
import path from "node:path";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { collectApplyAttemptLedgerPaths } from "./attempt-sources.js";
import { nativeRunLogPath } from "../orchestration/native-run-log.js";
import { redactLogLine, tailJsonlByAttempt } from "./log-tail.js";
import { redactRecord } from "./redact.js";

export type AppLogEvent = {
  ts: string | null;
  message: string;
  source: string;
};

function readTailJsonlLines(filePath: string, maxLines: number): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.slice(-maxLines);
}

function lineMatchesFilters(line: string, attemptId?: string, event?: string): boolean {
  if (attemptId && !line.includes(attemptId)) {
    return false;
  }
  if (event && !line.includes(event)) {
    return false;
  }
  return true;
}

function jsonlLinesToEvents(lines: string[], source: string): AppLogEvent[] {
  const events: AppLogEvent[] = [];
  for (const line of lines) {
    const redacted = redactLogLine(line);
    let ts: string | null = null;
    let message = redacted;
    try {
      const parsed = JSON.parse(redacted) as Record<string, unknown>;
      const row = redactRecord(parsed);
      if (typeof row.ts === "string") {
        ts = row.ts;
      }
      if (typeof row.event === "string") {
        message = `${row.event} ${JSON.stringify(row)}`.slice(0, 800);
      } else {
        message = JSON.stringify(row).slice(0, 800);
      }
    } catch {
      message = redacted.slice(0, 800);
    }
    events.push({ ts, message, source });
  }
  return events;
}

/**
 * Ledger-backed log export for MCP observability (no Docker socket / host APIs).
 */
export function collectAppLogEvents(
  workspace: WorkspaceRecord | null | undefined,
  options: {
    sinceMinutes: number;
    attemptId?: string;
    event?: string;
    limit: number;
  },
): { events: AppLogEvent[]; source: string } {
  const bounded = Math.min(Math.max(1, options.limit), 200);
  const cutoffMs = Date.now() - Math.min(Math.max(1, options.sinceMinutes), 24 * 60) * 60 * 1000;
  const attemptId = options.attemptId?.trim();
  const event = options.event?.trim();

  const merged: AppLogEvent[] = [];

  if (attemptId) {
    for (const ledgerPath of collectApplyAttemptLedgerPaths(workspace)) {
      const hits = tailJsonlByAttempt(ledgerPath, attemptId, bounded);
      for (const hit of hits) {
        merged.push({
          ts: typeof hit.startedAt === "string" ? hit.startedAt : typeof hit.ts === "string" ? hit.ts : null,
          message: JSON.stringify(redactRecord(hit)).slice(0, 800),
          source: path.basename(ledgerPath),
        });
      }
    }
  }

  const ledgerPaths = [
    ...collectApplyAttemptLedgerPaths(workspace),
    nativeRunLogPath(),
    path.join(path.dirname(nativeRunLogPath()), "mcp-gateway-audit.jsonl"),
  ];

  for (const filePath of ledgerPaths) {
    const lines = readTailJsonlLines(filePath, bounded * 4);
    for (const line of lines) {
      if (!lineMatchesFilters(line, attemptId, event)) {
        continue;
      }
      let ts: string | null = null;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const rawTs = parsed.ts ?? parsed.startedAt ?? parsed.createdAt;
        if (typeof rawTs === "string") {
          const ms = Date.parse(rawTs);
          if (Number.isFinite(ms) && ms < cutoffMs) {
            continue;
          }
          ts = rawTs;
        }
      } catch {
        // keep line without ts filter when unparseable
      }
      merged.push(...jsonlLinesToEvents([line], path.basename(filePath)));
    }
  }

  const events = merged.slice(-bounded);
  return { events, source: "ledger_jsonl" };
}

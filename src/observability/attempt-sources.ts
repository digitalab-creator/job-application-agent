import fs from "node:fs";
import path from "node:path";
import type { ApplyAttemptRecord } from "../models/types.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";

const ATTEMPT_ID_IN_NOTES = /attempt_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function collectApplyAttemptLedgerPaths(workspace?: WorkspaceRecord | null): string[] {
  const paths = new Set<string>();
  const defaultPath = process.env.APPLY_ATTEMPTS_PATH?.trim() || "/app/data/ledger/apply-attempts.jsonl";
  paths.add(defaultPath);
  const workspacePath = workspace?.applyAttemptsPath?.trim();
  if (workspacePath) {
    paths.add(workspacePath);
  }
  const internalSibling = path.join(path.dirname(defaultPath), "internal", "apply-attempts.jsonl");
  paths.add(internalSibling);
  return [...paths].filter((file) => file.length > 0);
}

export function parseAttemptsJsonlFile(filePath: string): ApplyAttemptRecord[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const out: ApplyAttemptRecord[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      out.push(JSON.parse(trimmed) as ApplyAttemptRecord);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

/** Latest terminal row per attemptId across one or more JSONL ledgers. */
export function mergeAttemptRecords(rows: ApplyAttemptRecord[]): ApplyAttemptRecord[] {
  const byId = new Map<string, ApplyAttemptRecord>();
  for (const row of rows) {
    const id = String(row.attemptId ?? "").trim();
    if (!id) {
      continue;
    }
    const prev = byId.get(id);
    if (!prev || attemptSortKey(row) >= attemptSortKey(prev)) {
      byId.set(id, row);
    }
  }
  return [...byId.values()].sort((a, b) => attemptSortKey(a) - attemptSortKey(b));
}

function attemptSortKey(row: ApplyAttemptRecord): number {
  const stamp = Date.parse(row.finishedAt || row.startedAt || "");
  return Number.isFinite(stamp) ? stamp : 0;
}

export function readAttemptsFromLedgerPaths(paths: string[]): {
  attempts: ApplyAttemptRecord[];
  sources: string[];
} {
  const merged: ApplyAttemptRecord[] = [];
  const sources: string[] = [];
  for (const filePath of paths) {
    const rows = parseAttemptsJsonlFile(filePath);
    if (rows.length === 0) {
      continue;
    }
    sources.push(filePath);
    merged.push(...rows);
  }
  return { attempts: mergeAttemptRecords(merged), sources };
}

export function findAttemptInLedgers(
  attemptId: string,
  workspace?: WorkspaceRecord | null,
): { record: ApplyAttemptRecord | null; sources: string[] } {
  const paths = collectApplyAttemptLedgerPaths(workspace);
  const { attempts, sources } = readAttemptsFromLedgerPaths(paths);
  const record = attempts.find((row) => row.attemptId === attemptId) ?? null;
  return { record, sources };
}

export type SheetAttemptHint = {
  rowNumber: number;
  company: string;
  role: string;
  jobUrl: string;
  status: string;
  notesExcerpt: string;
};

export function findAttemptHintOnSheet(
  sheetRows: JobSheetRow[],
  attemptId: string,
): SheetAttemptHint | null {
  const needle = attemptId.toLowerCase();
  for (const row of sheetRows) {
    const notes = String(row.Notes ?? "");
    const idMatch = ATTEMPT_ID_IN_NOTES.exec(notes);
    if (!notes.toLowerCase().includes(needle) && idMatch?.[1]?.toLowerCase() !== needle) {
      continue;
    }
    return {
      rowNumber: Number(row.row_number ?? 0),
      company: String(row.Company ?? ""),
      role: String(row.Role ?? ""),
      jobUrl: String(row["Job URL"] ?? ""),
      status: String(row.Status ?? ""),
      notesExcerpt: notes.slice(0, 400),
    };
  }
  return null;
}

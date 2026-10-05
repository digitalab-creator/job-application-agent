import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ApplicationResult,
  ApplyAttemptRecord,
  AttemptOutcome,
  AttemptPipeline,
} from "../models/types.js";

export function newAttemptId(): string {
  return randomUUID();
}

/**
 * Persist one current terminal row per attempt.
 *
 * The file is JSONL for easy operational inspection, but replacement is done
 * atomically so a later non-confirmed error cannot overwrite a confirmed send.
 */
export function rememberAttemptOutcome(record: ApplyAttemptRecord): ApplyAttemptRecord {
  const rows = readAttemptRows();
  const existing = rows.find((row) => row.attemptId === record.attemptId);
  if (existing?.outcome === "applied" && record.outcome !== "applied") {
    return existing;
  }

  const next = rows.filter((row) => row.attemptId !== record.attemptId);
  next.push(record);
  writeAttemptRows(next);
  return record;
}

export function attemptRecordFromResult(
  input: {
    attemptId: string;
    company: string;
    role: string;
    url: string;
    startedAt: string;
  },
  result: ApplicationResult,
  finishedAt = new Date().toISOString(),
): ApplyAttemptRecord {
  return {
    attemptId: input.attemptId,
    startedAt: input.startedAt,
    finishedAt,
    company: input.company,
    role: result.recoveredFrom?.replacementRole ?? input.role,
    originalJobUrl: input.url,
    canonicalJobUrl: result.canonicalJobUrl,
    cvPath: result.cvPath,
    outcome: result.terminalOutcome ?? inferAttemptOutcome(result),
    blocker: result.blocker,
    submitted: result.submitted,
    confirmationDetected: result.confirmationDetected,
    pipeline: result.pipeline ?? defaultPipeline(result),
    notes: result.notes,
  };
}

export function inferAttemptOutcome(result: ApplicationResult): AttemptOutcome {
  if (result.confirmationDetected || result.status === "applied") {
    return "applied";
  }
  if (result.status === "manual_required") {
    return "manual_required";
  }
  if (result.status === "closed") {
    return result.blocker === "no_suitable_replacement"
      ? "no_suitable_replacement"
      : "closed";
  }
  if (result.status === "location_ineligible") {
    return "location_ineligible";
  }
  if (result.status === "not_relevant") {
    if (result.blocker === "no_suitable_replacement") {
      return "no_suitable_replacement";
    }
    return "not_relevant";
  }
  if (result.status === "invalid_url") {
    return "invalid_url";
  }
  if (result.status === "quota_reached") {
    return "quota_reached";
  }
  if (result.status === "budget_reached") {
    return "budget_reached";
  }
  if (result.status === "already_submitted") {
    return "already_submitted";
  }
  switch (result.blocker) {
    case "navigation_failed":
      return "navigation_failed";
    case "form_not_detected":
      return "form_not_detected";
    case "form_validation":
      return "form_validation";
    case "cv_generation_failed":
      return "cv_generation_failed";
    case "confirmation_not_detected":
      return "confirmation_not_detected";
    default:
      return result.blocker === "dry_run" ? "dry_run" : "request_failed";
  }
}

export function readApplyAttempts(day?: string): ApplyAttemptRecord[] {
  const rows = readAttemptRows();
  if (!day) {
    return rows;
  }
  return rows.filter((row) => row.finishedAt.startsWith(day));
}

function defaultPipeline(result: ApplicationResult): AttemptPipeline {
  return {
    urlValidated: result.terminalOutcome !== "invalid_url",
    opened: Boolean(result.canonicalJobUrl || result.persona),
    recovered: Boolean(result.recoveredFrom),
    fitPassed: Boolean(result.persona),
    cvGenerated: Boolean(result.cvPath),
    cvQualityPassed: Boolean(result.cvPath),
    submitted: result.submitted,
    confirmed: result.confirmationDetected,
  };
}

function readAttemptRows(): ApplyAttemptRecord[] {
  const filePath = attemptLedgerPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ApplyAttemptRecord];
      } catch {
        return [];
      }
    });
}

function writeAttemptRows(rows: ApplyAttemptRecord[]): void {
  const filePath = attemptLedgerPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  fs.renameSync(temporary, filePath);
}

function attemptLedgerPath(): string {
  return process.env.APPLY_ATTEMPTS_PATH?.trim() || "/app/data/ledger/apply-attempts.jsonl";
}

import { log } from "../logging/logger.js";
import { scheduleSlotKey } from "../time/jerusalem-day.js";
import { decryptSecret } from "./crypto.js";
import { withDb } from "./db.js";
import { appendNativeRunLog } from "./native-run-log.js";
import { claimScheduledSlot } from "./schedule-claim.js";
import { googleAccessTokenFromRefresh } from "./sheets/google-auth.js";
import { readJobSheetRows, updateJobSheetRow, type JobSheetRow } from "./sheets/job-sheet.js";
import { insertOrchestrationRun, markWorkspaceRunKey } from "./workspace-store.js";
import type { WorkspaceRecord } from "./workspace-types.js";

/** Closed classifier output. The model picks one; code only checks the shape. */
export const OUTCOME_LABELS = ["rejection", "interview_or_follow_up", "ignore"] as const;
export type OutcomeLabel = (typeof OUTCOME_LABELS)[number];

export const HIGH_CONFIDENCE = 0.85;
const MAX_MESSAGES_PER_RUN = 15;

const APPLIED_STATUSES = new Set(["applied", "submitted", "review", "interview", "follow-up", "follow up"]);

export type ClassifiedOutcome = {
  label: OutcomeLabel;
  confidence: number;
  company: string;
  role: string;
  nextStep: string;
};

export type OutcomeDecision =
  | { kind: "update"; rowNumber: number; status: string; note: string; label: OutcomeLabel }
  | { kind: "review"; reason: string; rowNumbers: number[] }
  | { kind: "ignore"; reason: string };

export type OutcomeStats = {
  byCategory: Array<{ category: string; applied: number; rejected: number; advanced: number; rejectionRate: number }>;
  byRoleFamily: Array<{ roleFamily: string; applied: number; rejected: number; advanced: number }>;
  medianDaysToOutcome: number | null;
};

type GmailList = { messages?: Array<{ id: string }> };
type GmailPart = { body?: { data?: string }; parts?: GmailPart[]; headers?: Array<{ name: string; value: string }> };
type GmailMessage = { id: string; snippet?: string; payload?: GmailPart };

const CLASSIFIER_SYSTEM = `You classify one email for a job applicant.
Return JSON only with this shape:
{"label":"rejection"|"interview_or_follow_up"|"ignore","confidence":0.0,"company":"","role":"","nextStep":""}
label "rejection" means the employer declined.
label "interview_or_follow_up" means an interview, scheduling, or a request for more information.
label "ignore" means the email is not a hiring outcome (newsletters, receipts, security codes, unrelated mail).
confidence is 0 to 1. Leave company and role empty when the email does not name them. Do not invent either.`;

export function parseClassifiedOutcome(raw: unknown): ClassifiedOutcome | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const label = row.label;
  if (typeof label !== "string" || !OUTCOME_LABELS.includes(label as OutcomeLabel)) {
    return null;
  }
  const confidence = typeof row.confidence === "number" ? row.confidence : Number(row.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }
  return {
    label: label as OutcomeLabel,
    confidence,
    company: typeof row.company === "string" ? row.company.trim() : "",
    role: typeof row.role === "string" ? row.role.trim() : "",
    nextStep: typeof row.nextStep === "string" ? row.nextStep.trim() : "",
  };
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function companyScore(emailCompany: string, rowCompany: string): number {
  const email = norm(emailCompany);
  const row = norm(rowCompany);
  if (!email || !row || row.length < 2) {
    return 0;
  }
  if (email === row) {
    return 3;
  }
  if (email.includes(row) || row.includes(email)) {
    return 2;
  }
  return 0;
}

function isAppliedRow(row: JobSheetRow): boolean {
  const status = norm(String(row.Status ?? ""));
  return APPLIED_STATUSES.has(status);
}

export function decideOutcomeUpdate(
  classified: ClassifiedOutcome,
  rows: JobSheetRow[],
  subject: string,
  outcomeDate: string,
): OutcomeDecision {
  if (classified.label === "ignore") {
    return { kind: "ignore", reason: "classifier_ignore" };
  }
  if (!classified.company) {
    return { kind: "review", reason: "missing_company", rowNumbers: [] };
  }
  const scored = rows
    .filter(isAppliedRow)
    .map((row) => ({
      row,
      score: companyScore(classified.company, String(row.Company ?? "")),
    }))
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return { kind: "ignore", reason: "no_sheet_match" };
  }
  const best = scored[0]?.score ?? 0;
  const tied = scored.filter((item) => item.score === best);
  const rowNumbers = tied.flatMap((item) => (typeof item.row.row_number === "number" ? [item.row.row_number] : []));
  if (tied.length !== 1 || rowNumbers.length !== 1) {
    return { kind: "review", reason: "ambiguous_company", rowNumbers };
  }
  if (classified.confidence < HIGH_CONFIDENCE) {
    return { kind: "review", reason: "below_confidence", rowNumbers };
  }
  const row = tied[0].row;
  const rowNumber = rowNumbers[0];
  if (rowNumber === undefined) {
    return { kind: "review", reason: "missing_row_number", rowNumbers: [] };
  }
  const status = sheetStatusFor(classified, subject);
  const prior = String(row.Notes ?? "").trim();
  const line = `${outcomeDate} outcome: ${classified.label} | ${subject}`.slice(0, 400);
  return {
    kind: "update",
    rowNumber,
    status,
    note: prior ? `${prior}\n${line}` : line,
    label: classified.label,
  };
}

function sheetStatusFor(classified: ClassifiedOutcome, subject: string): string {
  if (classified.label === "rejection") {
    return "Rejected";
  }
  const blob = `${classified.nextStep} ${subject}`;
  if (/interview|ראיון/i.test(blob)) {
    return "Interview";
  }
  return "Follow-up";
}

export function outcomeStats(rows: JobSheetRow[]): OutcomeStats {
  const byCategory = new Map<string, { applied: number; rejected: number; advanced: number }>();
  const byRole = new Map<string, { applied: number; rejected: number; advanced: number }>();
  const dayGaps: number[] = [];
  for (const row of rows) {
    const status = norm(String(row.Status ?? ""));
    if (!APPLIED_STATUSES.has(status) && status !== "rejected") {
      continue;
    }
    const category = String(row.Category ?? "").trim() || "Uncategorized";
    const roleFamily = roleFamilyOf(String(row.Role ?? ""));
    const cat = byCategory.get(category) ?? { applied: 0, rejected: 0, advanced: 0 };
    const role = byRole.get(roleFamily) ?? { applied: 0, rejected: 0, advanced: 0 };
    cat.applied += 1;
    role.applied += 1;
    if (status === "rejected") {
      cat.rejected += 1;
      role.rejected += 1;
    }
    if (status === "interview" || status === "follow-up" || status === "follow up") {
      cat.advanced += 1;
      role.advanced += 1;
    }
    byCategory.set(category, cat);
    byRole.set(roleFamily, role);
    const gap = daysFromAppliedToOutcome(row);
    if (gap !== null) {
      dayGaps.push(gap);
    }
  }
  dayGaps.sort((a, b) => a - b);
  const mid = Math.floor(dayGaps.length / 2);
  return {
    byCategory: [...byCategory.entries()].map(([category, counts]) => ({
      category,
      ...counts,
      rejectionRate: counts.applied === 0 ? 0 : counts.rejected / counts.applied,
    })),
    byRoleFamily: [...byRole.entries()].map(([roleFamily, counts]) => ({ roleFamily, ...counts })),
    medianDaysToOutcome: dayGaps.length === 0 ? null : dayGaps[mid] ?? null,
  };
}

function roleFamilyOf(role: string): string {
  const token = norm(role).split(" ").find((part) => part.length >= 4);
  return token || "unknown";
}

function daysFromAppliedToOutcome(row: JobSheetRow): number | null {
  const applied = Date.parse(String(row["Applied Date"] ?? ""));
  const note = String(row.Notes ?? "");
  const match = note.match(/(\d{4}-\d{2}-\d{2}) outcome:/);
  if (!Number.isFinite(applied) || !match?.[1]) {
    return null;
  }
  const outcome = Date.parse(match[1]);
  if (!Number.isFinite(outcome)) {
    return null;
  }
  return Math.max(0, Math.round((outcome - applied) / 86_400_000));
}

export async function classifyOutcomeEmail(input: {
  subject: string;
  body: string;
  complete?: (system: string, user: string) => Promise<unknown>;
}): Promise<ClassifiedOutcome | null> {
  const complete = input.complete ?? (async (system: string, user: string) => {
    const { completeJson } = await import("../llm/client.js");
    return completeJson(system, user, undefined, "email_outcome");
  });
  const raw = await complete(CLASSIFIER_SYSTEM, `Subject: ${input.subject}\n\n${input.body.slice(0, 6000)}`);
  const parsed = parseClassifiedOutcome(raw);
  if (!parsed) {
    log("EMAIL_OUTCOME_CLASSIFIER_INVALID", { subject: input.subject.slice(0, 120) });
  }
  return parsed;
}

export type EmailOutcomeRunResult = {
  status: "ok" | "skipped" | "error";
  scanned: number;
  updated: number;
  review: number;
  notes: string;
  stats?: OutcomeStats;
};

export async function runWorkspaceEmailOutcomes(options: {
  workspace: WorkspaceRecord;
  runSource: "native_schedule" | "native_manual";
  dryRun: boolean;
}): Promise<EmailOutcomeRunResult> {
  const { workspace, runSource, dryRun } = options;
  const startedAt = new Date().toISOString();
  const claim = await claimScheduledSlot(workspace, "outcome", runSource);
  if (!claim.ok) {
    return { status: "skipped", scanned: 0, updated: 0, review: 0, notes: claim.reason };
  }
  const refreshEnc = workspace.mailboxRefreshTokenEnc;
  if (!refreshEnc || !workspace.mailboxEmail) {
    const result: EmailOutcomeRunResult = {
      status: "skipped",
      scanned: 0,
      updated: 0,
      review: 0,
      notes: "workspace_mailbox_missing",
    };
    await finishOutcomeRun(workspace, runSource, startedAt, result);
    return result;
  }
  try {
    const refresh = decryptSecret(refreshEnc);
    const token = await googleAccessTokenFromRefresh(refresh);
    const messages = await listRecentMessages(token);
    let updated = 0;
    let review = 0;
    const rows = await readJobSheetRows(workspace);
    for (const message of messages) {
      if (await messageAlreadyRecorded(workspace.id, message.id)) {
        continue;
      }
      try {
        const full = await readMessage(token, message.id);
        if (!full) {
          continue;
        }
        const subject = headerValue(full, "Subject");
        if (/security code|verification code|קוד אבטחה/i.test(subject)) {
          await rememberMessage(workspace.id, message.id, dryRun);
          continue;
        }
        const body = `${full.snippet ?? ""}\n${payloadText(full.payload)}`;
        const classified = await classifyOutcomeEmail({ subject, body });
        if (!classified) {
          continue;
        }
        const outcomeDate = new Date().toISOString().slice(0, 10);
        const decision = decideOutcomeUpdate(classified, rows, subject, outcomeDate);
        if (decision.kind === "update") {
          updated += 1;
          log("EMAIL_OUTCOME_UPDATE", {
            workspaceId: workspace.id,
            row: decision.rowNumber,
            status: decision.status,
            label: decision.label,
          });
          if (!dryRun) {
            await updateJobSheetRow(workspace, decision.rowNumber, {
              Status: decision.status,
              Notes: decision.note,
            });
          }
        } else if (decision.kind === "review") {
          review += 1;
          log("EMAIL_OUTCOME_REVIEW", {
            workspaceId: workspace.id,
            reason: decision.reason,
            rows: decision.rowNumbers.join(","),
            subject: subject.slice(0, 140),
          });
        }
        await rememberMessage(workspace.id, message.id, dryRun);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        log("EMAIL_OUTCOME_MESSAGE_FAILED", { workspaceId: workspace.id, messageId: message.id, message: messageText });
      }
    }
    const result: EmailOutcomeRunResult = {
      status: "ok",
      scanned: messages.length,
      updated,
      review,
      notes: `scanned=${messages.length} updated=${updated} review=${review}`,
      stats: outcomeStats(rows),
    };
    await finishOutcomeRun(workspace, runSource, startedAt, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("EMAIL_OUTCOME_FAILED", { workspaceId: workspace.id, message });
    const result: EmailOutcomeRunResult = { status: "error", scanned: 0, updated: 0, review: 0, notes: message };
    await finishOutcomeRun(workspace, runSource, startedAt, result);
    return result;
  }
}

async function finishOutcomeRun(
  workspace: WorkspaceRecord,
  runSource: "native_schedule" | "native_manual",
  startedAt: string,
  result: EmailOutcomeRunResult,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const runKey = runSource === "native_schedule"
    ? scheduleSlotKey("outcome", workspace.timezone, new Date(startedAt))
    : startedAt.slice(0, 16);
  try {
    await markWorkspaceRunKey(workspace.id, "outcome", runKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("EMAIL_OUTCOME_RUN_KEY_FAILED", { workspaceId: workspace.id, message });
  }
  appendNativeRunLog({
    workspaceId: workspace.id,
    kind: "outcome",
    runSource,
    startedAt,
    finishedAt,
    status: result.status,
    summary: { scanned: result.scanned, updated: result.updated, review: result.review, notes: result.notes },
  });
  try {
    await withDb(async (client) => {
      await insertOrchestrationRun(client, {
        workspaceId: workspace.id,
        kind: "outcome",
        runSource,
        startedAt,
        finishedAt,
        status: result.status,
        summary: { scanned: result.scanned, updated: result.updated, review: result.review, notes: result.notes },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ORCHESTRATION_RUN_DB_LOG_FAILED", { workspaceId: workspace.id, message });
  }
}

async function listRecentMessages(accessToken: string): Promise<Array<{ id: string }>> {
  const query = "newer_than:21d -category:promotions";
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${MAX_MESSAGES_PER_RUN}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail list failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as GmailList;
  return json.messages ?? [];
}

async function readMessage(accessToken: string, id: string): Promise<GmailMessage | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    log("EMAIL_OUTCOME_MESSAGE_READ_FAILED", { id, status: res.status });
    return null;
  }
  return (await res.json()) as GmailMessage;
}

function headerValue(message: GmailMessage, name: string): string {
  const headers = message.payload?.headers ?? [];
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function payloadText(part: GmailPart | undefined): string {
  if (!part) {
    return "";
  }
  const chunks: string[] = [];
  if (part.body?.data) {
    chunks.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
  }
  for (const child of part.parts ?? []) {
    chunks.push(payloadText(child));
  }
  return chunks.join("\n");
}

async function messageAlreadyRecorded(workspaceId: string, messageId: string): Promise<boolean> {
  return withDb(async (client) => {
    const res = await client.query(
      "SELECT 1 FROM email_message_dedupe WHERE workspace_id = $1 AND gmail_message_id = $2",
      [workspaceId, messageId],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

async function rememberMessage(workspaceId: string, messageId: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    return;
  }
  await withDb(async (client) => {
    await client.query(
      `INSERT INTO email_message_dedupe (workspace_id, gmail_message_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [workspaceId, messageId],
    );
  });
}

import { randomUUID } from "node:crypto";
import { claimBrowserApply, releaseBrowserApply } from "../application/browser-apply-lock.js";
import { executeApply } from "../application/execute-apply.js";
import type { ApplyInput } from "../application/apply-job.js";
import { claimApplyRun, releaseApplyRun } from "../application/run-lock.js";
import { buildCvDocument, writeCvPdf } from "../cv/generate.js";
import { choosePersonaFromText } from "../cv/persona-from-text.js";
import { env } from "../config/env.js";
import { withHeadlessBrowser } from "../browser/session.js";
import { opportunityKindFromRow } from "../freelance/opportunity-kind.js";
import { postingKeyFromSheetRow } from "../orchestration/sheets/sheet-posting-keys.js";
import { sheetMatchScore } from "../orchestration/pick-jobs.js";
import { readJobSheetRows, type JobSheetRow } from "../orchestration/sheets/job-sheet.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { runtimeFromWorkspace, withWorkspaceRuntime } from "../orchestration/workspace-runtime.js";
import { findJobSheetRow } from "./job-sheet-lookup.js";
import { markCanonicalJobSubmitGuard } from "./canonical-job-submit-guard.js";
import { assessMcpApplyEligibility } from "./mcp-apply-eligibility.js";
import {
  beginMcpIdempotency,
  findMcpIdempotencyForScope,
  finishMcpIdempotency,
  markMcpIdempotencyUncertain,
  recordMcpSubmissionStage,
  type McpIdempotencyScope,
} from "./mcp-idempotency-store.js";
import { loadMcpCvPreview, publicMcpCvPreviewMeta, storeMcpCvPreview } from "./mcp-cv-preview-store.js";
import type { ApplicationResult } from "../models/types.js";
import { log } from "../logging/logger.js";

export type McpApplyOneInput = {
  workspace: WorkspaceRecord;
  rowNumber: number;
  submit: boolean;
  idempotencyKey: string;
  jobText?: string;
};

export type McpRequestApplicationInput = {
  workspace: WorkspaceRecord;
  idempotencyKey: string;
  rowNumber?: number;
  jobUrl?: string;
  canonicalJobId?: string;
};

export type McpApplyOneResult = Record<string, unknown>;

import { MCP_APPLY_TOOL, MCP_REQUEST_APPLICATION_TOOL } from "./mcp-tools.js";

export { MCP_APPLY_TOOL, MCP_REQUEST_APPLICATION_TOOL };

const backgroundAttemptIds = new Set<string>();

function idempotencyScope(
  tool: string,
  input: { workspace: WorkspaceRecord; idempotencyKey: string; rowNumber: number; submit: boolean },
  row: Record<string, unknown>,
): McpIdempotencyScope {
  return {
    tool,
    idempotencyKey: input.idempotencyKey,
    workspaceId: input.workspace.id,
    rowNumber: input.rowNumber,
    submit: input.submit,
    jobUrl: String(row["Job URL"] ?? ""),
    company: String(row.Company ?? ""),
    role: String(row.Role ?? ""),
  };
}

function uncertainSubmission(outcome: ApplicationResult): boolean {
  if (outcome.pipeline?.submitted && !outcome.confirmationDetected) {
    return true;
  }
  return outcome.blocker === "submitted_unconfirmed";
}

function acceptedRequestPayload(input: {
  attemptId: string;
  rowNumber: number;
  canonicalJobId: string | null;
  status: "queued" | "running";
  idempotentReplay?: boolean;
}): Record<string, unknown> {
  return {
    attemptId: input.attemptId,
    status: input.status,
    rowNumber: input.rowNumber,
    canonicalJobId: input.canonicalJobId,
    submit: true,
    ...(input.idempotentReplay ? { idempotentReplay: true } : {}),
  };
}

export async function handleMcpPreviewCv(input: {
  workspace: WorkspaceRecord;
  rowNumber: number;
  jobText?: string;
}): Promise<Record<string, unknown>> {
  const rows = await readJobSheetRows(input.workspace);
  const row = findJobSheetRow(rows, { rowNumber: input.rowNumber });
  if (!row) {
    return { error: "job_not_found", rowNumber: input.rowNumber };
  }
  const role = String(row.Role ?? "");
  const company = String(row.Company ?? "");
  const jobText = input.jobText?.trim() || role;
  const preview = await withHeadlessBrowser(async (browser) => {
    const persona = choosePersonaFromText(role, String(row.Category ?? ""), role);
    if (!persona) {
      throw new Error("The preview role is ambiguous; provide jobText with enough requirements to choose a persona.");
    }
    const built = await buildCvDocument({
      persona,
      role,
      company,
      jobText,
    });
    const outputPath = `${env.generatedCvDir}/mcp-preview-${Date.now()}.pdf`;
    await writeCvPdf(browser, built.doc, persona, outputPath);
    return { persona, headlineId: built.doc.headlineId, cvPath: outputPath };
  });
  const stored = storeMcpCvPreview({
    workspaceId: input.workspace.id,
    rowNumber: input.rowNumber,
    company,
    role,
    persona: preview.persona,
    headlineId: preview.headlineId,
    cvPath: preview.cvPath,
  });
  return publicMcpCvPreviewMeta(stored);
}

export async function handleMcpGetPreviewCv(input: {
  workspace: WorkspaceRecord;
  previewId: string;
}): Promise<Record<string, unknown>> {
  const record = loadMcpCvPreview(input.workspace.id, input.previewId);
  if (!record) {
    return { error: "preview_not_found_or_expired" };
  }
  return publicMcpCvPreviewMeta(record);
}

export async function resolveMcpApplyRow(
  workspace: WorkspaceRecord,
  query: { rowNumber?: number; jobUrl?: string; canonicalJobId?: string },
): Promise<{ row: JobSheetRow; canonicalJobId: string | null } | { error: string }> {
  const hasRow = query.rowNumber !== undefined && Number.isFinite(query.rowNumber);
  const hasUrl = Boolean(query.jobUrl?.trim());
  const hasCanonical = Boolean(query.canonicalJobId?.trim());
  const count = [hasRow, hasUrl, hasCanonical].filter(Boolean).length;
  if (count !== 1) {
    return { error: "exactly_one_job_identifier_required" };
  }
  const rows = await readJobSheetRows(workspace);
  const row = findJobSheetRow(rows, {
    rowNumber: query.rowNumber,
    jobUrl: query.jobUrl,
    canonicalJobId: query.canonicalJobId,
  });
  if (!row) {
    return { error: "job_not_found" };
  }
  const rowNumber = Number(row.row_number ?? 0);
  return { row, canonicalJobId: postingKeyFromSheetRow(row) };
}

export async function handleMcpRequestApplication(input: McpRequestApplicationInput): Promise<McpApplyOneResult> {
  const resolved = await resolveMcpApplyRow(input.workspace, {
    rowNumber: input.rowNumber,
    jobUrl: input.jobUrl,
    canonicalJobId: input.canonicalJobId,
  });
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  const { row, canonicalJobId } = resolved;
  const rowNumber = Number(row.row_number ?? 0);
  const scope = idempotencyScope(
    MCP_REQUEST_APPLICATION_TOOL,
    { ...input, rowNumber, submit: true },
    row as Record<string, unknown>,
  );
  const attemptId = randomUUID();
  const idem = await beginMcpIdempotency(input.workspace, scope, attemptId);
  if (idem.action === "replay") {
    return acceptedRequestPayload({
      attemptId: String((idem.response as { attemptId?: string }).attemptId ?? attemptId),
      rowNumber,
      canonicalJobId,
      status: "running",
      idempotentReplay: true,
    });
  }
  if (idem.action === "reject") {
    const peek = await findMcpIdempotencyForScope(scope);
    return { error: idem.error, state: idem.state ?? null, attemptId: peek?.attemptId ?? attemptId };
  }
  if (idem.action === "wait") {
    const peek = await findMcpIdempotencyForScope(scope);
    return acceptedRequestPayload({
      attemptId: peek?.attemptId ?? attemptId,
      rowNumber,
      canonicalJobId,
      status: "running",
      idempotentReplay: true,
    });
  }

  if (idem.action !== "proceed") {
    return { error: "idempotency_unexpected_state" };
  }
  const proceedAttemptId = idem.attemptId;
  const ownerToken = idem.ownerToken;

  const eligibility = await assessMcpApplyEligibility(input.workspace, row);
  if (!eligibility.ok) {
    await finishMcpIdempotency(scope, proceedAttemptId, { state: "FAILED" }, ownerToken);
    return {
      error: eligibility.error,
      blockers: eligibility.blockers,
      attemptId: proceedAttemptId,
      status: "failed",
    };
  }

  const accepted = acceptedRequestPayload({
    attemptId: proceedAttemptId,
    rowNumber,
    canonicalJobId,
    status: "queued",
  });
  scheduleMcpApplyExecution({
    workspace: input.workspace,
    rowNumber,
    submit: true,
    idempotencyKey: input.idempotencyKey,
    scope,
    attemptId: proceedAttemptId,
    ownerToken,
    row,
    tool: MCP_REQUEST_APPLICATION_TOOL,
    acceptedResponse: accepted,
  });
  return accepted;
}

type ScheduledMcpApply = {
  workspace: WorkspaceRecord;
  rowNumber: number;
  submit: boolean;
  idempotencyKey: string;
  scope: McpIdempotencyScope;
  attemptId: string;
  ownerToken: string;
  row: JobSheetRow;
  tool: string;
  acceptedResponse: Record<string, unknown>;
};

function scheduleMcpApplyExecution(job: ScheduledMcpApply): void {
  if (backgroundAttemptIds.has(job.attemptId)) {
    return;
  }
  backgroundAttemptIds.add(job.attemptId);
  setImmediate(() => {
    void runMcpApplyAttempt(job)
      .catch((error) => {
        log("MCP_APPLY_BACKGROUND_FAILED", {
          attemptId: job.attemptId,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        backgroundAttemptIds.delete(job.attemptId);
      });
  });
}

async function runMcpApplyAttempt(job: ScheduledMcpApply): Promise<McpApplyOneResult> {
  return executeMcpApplyAttempt({
    workspace: job.workspace,
    rowNumber: job.rowNumber,
    submit: job.submit,
    idempotencyKey: job.idempotencyKey,
    scope: job.scope,
    attemptId: job.attemptId,
    ownerToken: job.ownerToken,
    row: job.row,
    persistResponse: job.acceptedResponse,
  });
}

export async function handleMcpApplyOne(input: McpApplyOneInput): Promise<McpApplyOneResult> {
  const rows = await readJobSheetRows(input.workspace);
  const row = findJobSheetRow(rows, { rowNumber: input.rowNumber });
  if (!row) {
    return { error: "job_not_found", rowNumber: input.rowNumber };
  }

  const scope = idempotencyScope(MCP_APPLY_TOOL, input, row as Record<string, unknown>);
  const attemptId = randomUUID();
  const idem = await beginMcpIdempotency(input.workspace, scope, attemptId);
  if (idem.action === "replay") {
    return { idempotentReplay: true, ...idem.response };
  }
  if (idem.action === "reject") {
    return { error: idem.error, state: idem.state ?? null };
  }
  if (idem.action === "wait") {
    return { error: idem.error, state: idem.state };
  }

  if (input.submit) {
    const eligibility = await assessMcpApplyEligibility(input.workspace, row);
    if (!eligibility.ok) {
      await finishMcpIdempotency(scope, idem.attemptId, { state: "FAILED" }, idem.ownerToken);
      return {
        error: eligibility.error,
        blockers: eligibility.blockers,
        attemptId: idem.attemptId,
      };
    }
  }

  return executeMcpApplyAttempt({
    workspace: input.workspace,
    rowNumber: input.rowNumber,
    submit: input.submit,
    idempotencyKey: input.idempotencyKey,
    scope,
    attemptId: idem.attemptId,
    ownerToken: idem.ownerToken,
    row,
  });
}

type ExecuteMcpApplyAttemptInput = {
  workspace: WorkspaceRecord;
  rowNumber: number;
  submit: boolean;
  idempotencyKey: string;
  scope: McpIdempotencyScope;
  attemptId: string;
  ownerToken: string;
  row: JobSheetRow;
  persistResponse?: Record<string, unknown>;
};

async function executeMcpApplyAttempt(input: ExecuteMcpApplyAttemptInput): Promise<McpApplyOneResult> {
  const { scope, attemptId, ownerToken, row } = input;
  const jobUrl = String(row["Job URL"] ?? "");

  const runLock = input.submit ? claimApplyRun(input.workspace.id) : { ok: true as const };
  if (!runLock.ok) {
    await finishMcpIdempotency(scope, attemptId, { state: "FAILED" }, ownerToken);
    return { error: "apply_run_in_progress", reason: runLock.reason, attemptId };
  }

  const browserClaim = claimBrowserApply();
  if (!browserClaim.ok) {
    if (input.submit) {
      releaseApplyRun(input.workspace.id);
    }
    await finishMcpIdempotency(scope, attemptId, { state: "FAILED" }, ownerToken);
    return { error: "apply_in_progress", reason: browserClaim.reason, attemptId };
  }

  const startedAt = new Date().toISOString();
  let enteredSubmissionStage = false;
  try {
    const applyInput: ApplyInput = {
      row: Number(row.row_number ?? input.rowNumber),
      submit: input.submit,
      mcpDryRun: !input.submit,
      workspaceId: input.workspace.id,
      runSource: "native_manual",
      runId: input.idempotencyKey,
      batchId: input.idempotencyKey,
      triggeredAt: startedAt,
      attemptId,
      startedAt,
      canonicalSubmitGuardOwnerToken: input.submit ? ownerToken : undefined,
      onSubmissionCheckpoint: input.submit
        ? async (stage) => {
            enteredSubmissionStage = true;
            await recordMcpSubmissionStage(scope, attemptId, ownerToken, stage);
          }
        : undefined,
      job: {
        role: String(row.Role ?? ""),
        company: String(row.Company ?? ""),
        url: jobUrl,
        matchScore: sheetMatchScore(row),
        category: String(row.Category ?? ""),
        estimatedSalary: String(row["Est. Salary Range"] ?? ""),
        opportunityKind: opportunityKindFromRow(row),
      },
    };

    const outcome = await withWorkspaceRuntime(
      runtimeFromWorkspace(input.workspace, "native_manual", {
        runId: input.idempotencyKey,
        batchId: input.idempotencyKey,
      }),
      () => executeApply(applyInput),
    );

    const response: Record<string, unknown> = {
      ...(input.persistResponse ?? {}),
      attemptId,
      rowNumber: input.rowNumber,
      submit: input.submit,
      status: input.persistResponse ? "completed" : undefined,
      outcome,
    };

    let finalState: "CONFIRMED" | "FAILED" | "UNKNOWN" = "CONFIRMED";
    if (input.submit && uncertainSubmission(outcome)) {
      finalState = "UNKNOWN";
    } else if (outcome.status === "review" && outcome.blocker && input.submit) {
      finalState = outcome.submitted || enteredSubmissionStage ? "UNKNOWN" : "FAILED";
    }

    if (finalState === "UNKNOWN") {
      if (input.submit) {
        await markCanonicalJobSubmitGuard(input.workspace.id, jobUrl, attemptId, ownerToken, "UNCERTAIN");
      }
      await markMcpIdempotencyUncertain(scope, attemptId, ownerToken);
      return { ...response, error: "submission_outcome_uncertain", state: finalState };
    }

    if (input.submit) {
      await markCanonicalJobSubmitGuard(
        input.workspace.id,
        jobUrl,
        attemptId,
        ownerToken,
        finalState === "CONFIRMED" ? "CONFIRMED" : "RELEASED",
      );
    }

    await finishMcpIdempotency(scope, attemptId, {
      state: finalState,
      response,
    }, ownerToken);
    return response;
  } catch (error) {
    log("MCP_APPLY_HANDLER_FAILED", {
      attemptId,
      submit: input.submit,
      enteredSubmissionStage,
      message: error instanceof Error ? error.message : String(error),
    });
    if (input.submit && enteredSubmissionStage) {
      await markCanonicalJobSubmitGuard(input.workspace.id, jobUrl, attemptId, ownerToken, "UNCERTAIN");
      await markMcpIdempotencyUncertain(scope, attemptId, ownerToken);
      return {
        error: "submission_outcome_uncertain",
        state: "UNKNOWN",
        attemptId,
      };
    }
    if (input.submit) {
      await markCanonicalJobSubmitGuard(input.workspace.id, jobUrl, attemptId, ownerToken, "RELEASED");
    }
    await finishMcpIdempotency(scope, attemptId, { state: "FAILED" }, ownerToken);
    throw error;
  } finally {
    releaseBrowserApply();
    if (input.submit) {
      releaseApplyRun(input.workspace.id);
    }
  }
}

/** Test hook: whether a background MCP apply is still scheduled or running. */
export function mcpBackgroundApplyActive(attemptId: string): boolean {
  return backgroundAttemptIds.has(attemptId);
}

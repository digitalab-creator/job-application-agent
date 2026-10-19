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
import { sheetMatchScore } from "../orchestration/pick-jobs.js";
import { readJobSheetRows } from "../orchestration/sheets/job-sheet.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { runtimeFromWorkspace, withWorkspaceRuntime } from "../orchestration/workspace-runtime.js";
import { findJobSheetRow } from "./job-sheet-lookup.js";
import { markCanonicalJobSubmitGuard } from "./canonical-job-submit-guard.js";
import {
  beginMcpIdempotency,
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

export type McpApplyOneResult = Record<string, unknown>;

const MCP_APPLY_TOOL = "jobagent_apply_one";

function idempotencyScope(input: McpApplyOneInput, row: Record<string, unknown>): McpIdempotencyScope {
  return {
    tool: MCP_APPLY_TOOL,
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

export async function handleMcpApplyOne(input: McpApplyOneInput): Promise<McpApplyOneResult> {
  const rows = await readJobSheetRows(input.workspace);
  const row = findJobSheetRow(rows, { rowNumber: input.rowNumber });
  if (!row) {
    return { error: "job_not_found", rowNumber: input.rowNumber };
  }

  const scope = idempotencyScope(input, row as Record<string, unknown>);
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

  const ownerToken = idem.ownerToken;
  const jobUrl = String(row["Job URL"] ?? "");

  const runLock = input.submit ? claimApplyRun(input.workspace.id) : { ok: true as const };
  if (!runLock.ok) {
    await finishMcpIdempotency(scope, idem.attemptId, { state: "FAILED" }, ownerToken);
    return { error: "apply_run_in_progress", reason: runLock.reason };
  }

  const browserClaim = claimBrowserApply();
  if (!browserClaim.ok) {
    if (input.submit) {
      releaseApplyRun(input.workspace.id);
    }
    await finishMcpIdempotency(scope, idem.attemptId, { state: "FAILED" }, ownerToken);
    return { error: "apply_in_progress", reason: browserClaim.reason };
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
      attemptId: idem.attemptId,
      startedAt,
      canonicalSubmitGuardOwnerToken: input.submit ? ownerToken : undefined,
      onSubmissionCheckpoint: input.submit
        ? async (stage) => {
            enteredSubmissionStage = true;
            await recordMcpSubmissionStage(scope, idem.attemptId, ownerToken, stage);
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
      attemptId: idem.attemptId,
      rowNumber: input.rowNumber,
      submit: input.submit,
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
        await markCanonicalJobSubmitGuard(input.workspace.id, jobUrl, idem.attemptId, ownerToken, "UNCERTAIN");
      }
      await markMcpIdempotencyUncertain(scope, idem.attemptId, ownerToken);
      return { ...response, error: "submission_outcome_uncertain", state: finalState };
    }

    if (input.submit) {
      await markCanonicalJobSubmitGuard(
        input.workspace.id,
        jobUrl,
        idem.attemptId,
        ownerToken,
        finalState === "CONFIRMED" ? "CONFIRMED" : "RELEASED",
      );
    }

    await finishMcpIdempotency(scope, idem.attemptId, {
      state: finalState,
      response,
    }, ownerToken);
    return response;
  } catch (error) {
    log("MCP_APPLY_HANDLER_FAILED", {
      attemptId: idem.attemptId,
      submit: input.submit,
      enteredSubmissionStage,
      message: error instanceof Error ? error.message : String(error),
    });
    if (input.submit && enteredSubmissionStage) {
      await markCanonicalJobSubmitGuard(input.workspace.id, jobUrl, idem.attemptId, ownerToken, "UNCERTAIN");
      await markMcpIdempotencyUncertain(scope, idem.attemptId, ownerToken);
      return {
        error: "submission_outcome_uncertain",
        state: "UNKNOWN",
        attemptId: idem.attemptId,
      };
    }
    if (input.submit) {
      await markCanonicalJobSubmitGuard(input.workspace.id, jobUrl, idem.attemptId, ownerToken, "RELEASED");
    }
    await finishMcpIdempotency(scope, idem.attemptId, { state: "FAILED" }, ownerToken);
    throw error;
  } finally {
    releaseBrowserApply();
    if (input.submit) {
      releaseApplyRun(input.workspace.id);
    }
  }
}

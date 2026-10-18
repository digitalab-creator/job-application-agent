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
import { readMcpIdempotency, rememberMcpIdempotency } from "./mcp-idempotency.js";

export type McpApplyOneInput = {
  workspace: WorkspaceRecord;
  rowNumber: number;
  submit: boolean;
  idempotencyKey: string;
  jobText?: string;
};

export type McpApplyOneResult = Record<string, unknown>;

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
    return { persona, wording: built.wording, cvPath: outputPath, headlineId: built.doc.headlineId };
  });
  return {
    rowNumber: input.rowNumber,
    company,
    role,
    ...preview,
  };
}

export async function handleMcpApplyOne(input: McpApplyOneInput): Promise<McpApplyOneResult> {
  const tool = "jobagent_apply_one";
  const cached = readMcpIdempotency(input.idempotencyKey, tool);
  if (cached) {
    return { idempotentReplay: true, ...cached.response };
  }

  const rows = await readJobSheetRows(input.workspace);
  const row = findJobSheetRow(rows, { rowNumber: input.rowNumber });
  if (!row) {
    return { error: "job_not_found", rowNumber: input.rowNumber };
  }

  const runLock = input.submit ? claimApplyRun(input.workspace.id) : { ok: true as const };
  if (!runLock.ok) {
    return { error: "apply_run_in_progress", reason: runLock.reason };
  }

  const browserClaim = claimBrowserApply();
  if (!browserClaim.ok) {
    if (input.submit) {
      releaseApplyRun(input.workspace.id);
    }
    return { error: "apply_in_progress", reason: browserClaim.reason };
  }

  const attemptId = randomUUID();
  const startedAt = new Date().toISOString();
  try {
    const applyInput: ApplyInput = {
      row: Number(row.row_number ?? input.rowNumber),
      submit: input.submit,
      workspaceId: input.workspace.id,
      runSource: "native_manual",
      runId: input.idempotencyKey,
      batchId: input.idempotencyKey,
      triggeredAt: startedAt,
      attemptId,
      startedAt,
      job: {
        role: String(row.Role ?? ""),
        company: String(row.Company ?? ""),
        url: String(row["Job URL"] ?? ""),
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
      attemptId,
      rowNumber: input.rowNumber,
      submit: input.submit,
      outcome,
    };
    rememberMcpIdempotency({
      key: input.idempotencyKey,
      tool,
      createdAt: new Date().toISOString(),
      response,
    });
    return response;
  } finally {
    releaseBrowserApply();
    if (input.submit) {
      releaseApplyRun(input.workspace.id);
    }
  }
}

import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { resolveAttemptExport } from "./attempt-export.js";
import { findMcpIdempotencyByAttemptId, type McpIdempotencyState } from "./mcp-idempotency-store.js";
import { redactRecord } from "./redact.js";

export type McpAttemptLifecycleStatus =
  | "queued"
  | "running"
  | "blocked"
  | "failed"
  | "confirmed"
  | "unknown";

export type McpAttemptStatusExport = {
  attemptId: string;
  workspaceId: string;
  status: McpAttemptLifecycleStatus;
  idempotency?: {
    key: string;
    tool: string;
    state: McpIdempotencyState;
    submissionStage?: string | null;
  };
  blocker?: string;
  otpDiagnostic?: string;
  confirmationDetected?: boolean;
  submitted?: boolean;
  evidence?: Record<string, unknown>;
  ledgerResolution?: string;
  message?: string;
};

function otpDiagnosticFromNotes(notes: string | undefined): string | undefined {
  if (!notes) {
    return undefined;
  }
  const match = notes.match(/otp_failure=([a-z_]+)/i);
  return match?.[1];
}

function lifecycleFromParts(input: {
  idemState?: McpIdempotencyState;
  ledgerOutcome?: string;
  blocker?: string;
  confirmationDetected?: boolean;
  submitted?: boolean;
  submissionStage?: string | null;
}): McpAttemptLifecycleStatus {
  if (input.confirmationDetected || input.ledgerOutcome === "applied") {
    return "confirmed";
  }
  if (input.idemState === "UNKNOWN" || input.idemState === "RECONCILIATION_REQUIRED") {
    return "unknown";
  }
  if (input.idemState === "CONFIRMED") {
    return "confirmed";
  }
  if (input.idemState === "FAILED") {
    return "failed";
  }
  if (input.blocker && input.blocker !== "submitted_unconfirmed") {
    return "blocked";
  }
  if (input.idemState === "RESERVED") {
    return "queued";
  }
  if (input.idemState === "IN_PROGRESS" || input.submissionStage) {
    return "running";
  }
  if (input.submitted && !input.confirmationDetected) {
    return "unknown";
  }
  if (input.ledgerOutcome === "failed" || input.ledgerOutcome === "budget_reached" || input.ledgerOutcome === "quota_reached") {
    return "failed";
  }
  if (input.blocker === "submitted_unconfirmed") {
    return "unknown";
  }
  return "running";
}

export async function resolveMcpAttemptStatus(
  attemptId: string,
  workspace: WorkspaceRecord,
): Promise<McpAttemptStatusExport> {
  const idem = await findMcpIdempotencyByAttemptId(attemptId, workspace.id);
  const ledger = await resolveAttemptExport(attemptId, workspace);

  const base: McpAttemptStatusExport = {
    attemptId,
    workspaceId: workspace.id,
    status: "running",
  };

  if (idem) {
    base.idempotency = {
      key: idem.idempotencyKey,
      tool: idem.tool,
      state: idem.state,
      submissionStage: idem.submissionStage ?? null,
    };
  }

  if (ledger.status === "found") {
    const attempt = ledger.attempt;
    const blocker = typeof attempt.blocker === "string" ? attempt.blocker : undefined;
    const notes = typeof attempt.notes === "string" ? attempt.notes : undefined;
    base.ledgerResolution = ledger.status;
    base.blocker = blocker;
    base.confirmationDetected = Boolean(attempt.confirmationDetected);
    base.submitted = Boolean(attempt.submitted);
    base.otpDiagnostic = otpDiagnosticFromNotes(notes);
    base.evidence = redactRecord({
      pipeline: attempt.pipeline,
      cvRef: attempt.cvRef,
      finishedAt: attempt.finishedAt,
      startedAt: attempt.startedAt,
      outcome: attempt.outcome,
    });
    base.status = lifecycleFromParts({
      idemState: idem?.state,
      ledgerOutcome: typeof attempt.outcome === "string" ? attempt.outcome : undefined,
      blocker,
      confirmationDetected: base.confirmationDetected,
      submitted: base.submitted,
      submissionStage: idem?.submissionStage ?? null,
    });
    if (base.status === "unknown") {
      base.message =
        "Submission may have reached the ATS but confirmation was not detected. Do not resubmit automatically.";
    }
    return base;
  }

  if (ledger.status === "sheet_only") {
    base.ledgerResolution = ledger.status;
    base.message = ledger.message;
    base.status = lifecycleFromParts({ idemState: idem?.state, submissionStage: idem?.submissionStage ?? null });
    return base;
  }

  base.ledgerResolution = "not_found";
  base.status = lifecycleFromParts({
    idemState: idem?.state,
    submissionStage: idem?.submissionStage ?? null,
  });
  if (base.status === "queued" || base.status === "running") {
    base.message = "Attempt is registered; worker ledger has not recorded a terminal outcome yet.";
  } else {
    base.message = ledger.message;
  }
  return base;
}

import { agencyContextFromUrl, submissionDedupKey, workspaceIdForDedup } from "../application/submission-scope.js";
import { withDb, workspaceDatabaseUrl } from "../orchestration/db.js";
import { log } from "../logging/logger.js";

export type CanonicalJobSubmitGuardState =
  | "ACTIVE"
  | "UNCERTAIN"
  | "CONFIRMED"
  | "RELEASED";

const BLOCKING_GUARD_STATES = ["ACTIVE", "UNCERTAIN", "CONFIRMED"] as const;

export function computeCanonicalJobDedupKey(workspaceId: string, jobUrl: string): string | null {
  const { intendedScope, agencyId, postingId } = agencyContextFromUrl(jobUrl);
  const ws = workspaceIdForDedup(workspaceId);
  return submissionDedupKey({
    workspaceId: ws,
    scope: intendedScope,
    agencyId,
    postingId,
    jobUrl,
  });
}

export async function claimCanonicalJobSubmitGuard(input: {
  workspaceId: string;
  jobUrl: string;
  attemptId: string;
  ownerToken: string;
  idempotencyKey?: string;
}): Promise<{ ok: true } | { ok: false; reason: string; attemptId?: string }> {
  const jobDedupKey = computeCanonicalJobDedupKey(input.workspaceId, input.jobUrl);
  if (!jobDedupKey || !workspaceDatabaseUrl()) {
    return { ok: true };
  }
  try {
    return await withDb(async (client) => {
      const insert = await client.query(
        `INSERT INTO canonical_job_submit_guard
           (workspace_id, job_dedup_key, attempt_id, owner_token, state, idempotency_key)
         VALUES ($1,$2,$3,$4,'ACTIVE',$5)
         ON CONFLICT (workspace_id, job_dedup_key) DO NOTHING
         RETURNING attempt_id`,
        [input.workspaceId, jobDedupKey, input.attemptId, input.ownerToken, input.idempotencyKey ?? null],
      );
      if ((insert.rowCount ?? 0) > 0) {
        return { ok: true as const };
      }
      const existing = await client.query(
        `SELECT attempt_id, state, owner_token FROM canonical_job_submit_guard
         WHERE workspace_id = $1 AND job_dedup_key = $2`,
        [input.workspaceId, jobDedupKey],
      );
      const row = existing.rows[0];
      if (!row) {
        return { ok: false, reason: "canonical_job_guard_race" };
      }
      const state = String(row.state);
      if (row.attempt_id === input.attemptId && row.owner_token === input.ownerToken) {
        return { ok: true as const };
      }
      if (state === "RELEASED") {
        const reclaimed = await client.query(
          `UPDATE canonical_job_submit_guard
             SET attempt_id = $3, owner_token = $4, state = 'ACTIVE', idempotency_key = $5, updated_at = NOW()
           WHERE workspace_id = $1 AND job_dedup_key = $2 AND state = 'RELEASED'
           RETURNING attempt_id`,
          [input.workspaceId, jobDedupKey, input.attemptId, input.ownerToken, input.idempotencyKey ?? null],
        );
        if ((reclaimed.rowCount ?? 0) > 0) {
          return { ok: true as const };
        }
      }
      if ((BLOCKING_GUARD_STATES as readonly string[]).includes(state)) {
        return {
          ok: false,
          reason: state === "CONFIRMED" ? "job_already_submitted" : "canonical_job_submit_in_progress",
          attemptId: String(row.attempt_id),
        };
      }
      return { ok: false, reason: "canonical_job_guard_blocked", attemptId: String(row.attempt_id) };
    });
  } catch (error) {
    log("CANONICAL_JOB_GUARD_CLAIM_FAILED", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "canonical_job_guard_unavailable" };
  }
}

export async function markCanonicalJobSubmitGuard(
  workspaceId: string,
  jobUrl: string,
  attemptId: string,
  ownerToken: string,
  state: CanonicalJobSubmitGuardState,
): Promise<void> {
  const jobDedupKey = computeCanonicalJobDedupKey(workspaceId, jobUrl);
  if (!jobDedupKey || !workspaceDatabaseUrl()) {
    return;
  }
  try {
    await withDb(async (client) => {
      await client.query(
        `UPDATE canonical_job_submit_guard
           SET state = $5, updated_at = NOW()
         WHERE workspace_id = $1 AND job_dedup_key = $2 AND attempt_id = $3 AND owner_token = $4`,
        [workspaceId, jobDedupKey, attemptId, ownerToken, state],
      );
    });
  } catch (error) {
    log("CANONICAL_JOB_GUARD_MARK_FAILED", {
      message: error instanceof Error ? error.message : String(error),
      state,
    });
  }
}

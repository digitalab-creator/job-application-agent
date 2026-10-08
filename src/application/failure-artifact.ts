import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { log } from "../logging/logger.js";

const ARTIFACT_DIR = path.join(path.dirname(env.ledgerPath), "failure-artifacts");

/** Redacted attempt context for retries (no full JD or PII). */
export function saveRedactedFailureArtifact(
  attemptId: string,
  payload: Record<string, unknown>,
): void {
  if (!attemptId.trim()) {
    return;
  }
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const filePath = path.join(ARTIFACT_DIR, `${attemptId}.json`);
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ ...payload, savedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    log("FAILURE_ARTIFACT_WRITE_FAILED", {
      attemptId,
      message: error instanceof Error ? error.message : "artifact_write_failed",
    });
  }
}

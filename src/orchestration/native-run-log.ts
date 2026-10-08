import fs from "node:fs";
import path from "node:path";
import { log } from "../logging/logger.js";

export type NativeRunLogEntry = {
  workspaceId: string;
  kind: "apply" | "discover";
  runSource: "native_schedule" | "native_manual";
  startedAt: string;
  finishedAt: string;
  status: string;
  summary: Record<string, unknown>;
};

export function nativeRunLogPath(): string {
  return process.env.NATIVE_RUN_LOG_PATH?.trim() || "/app/data/ledger/native-runs.jsonl";
}

export function appendNativeRunLog(entry: NativeRunLogEntry): void {
  const file = nativeRunLogPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  log("NATIVE_RUN_LOGGED", {
    workspaceId: entry.workspaceId,
    kind: entry.kind,
    status: entry.status,
    runSource: entry.runSource,
  });
}

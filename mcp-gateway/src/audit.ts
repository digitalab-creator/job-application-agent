import fs from "node:fs";
import path from "node:path";
import { gatewayConfig } from "./config.js";

export function auditToolCall(input: {
  tool: string;
  callerHint?: string;
  argsSummary: Record<string, unknown>;
  ok: boolean;
  error?: string;
}): void {
  const file = gatewayConfig.auditLogPath;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    tool: input.tool,
    callerHint: input.callerHint ?? "unknown",
    argsSummary: input.argsSummary,
    ok: input.ok,
    error: input.error?.slice(0, 300),
  });
  fs.appendFileSync(file, `${line}\n`, "utf8");
}

import fs from "node:fs";
import path from "node:path";
export type McpIdempotencyRecord = {
  key: string;
  tool: string;
  createdAt: string;
  response: Record<string, unknown>;
};

function idempotencyPath(): string {
  const configured = process.env.MCP_IDEMPOTENCY_PATH?.trim();
  if (configured) {
    return configured;
  }
  const ledgerDir = path.dirname(process.env.LEDGER_PATH?.trim() || "/app/data/ledger");
  return path.join(ledgerDir, "mcp-apply-idempotency.jsonl");
}

export function readMcpIdempotency(key: string, tool: string): McpIdempotencyRecord | null {
  const file = idempotencyPath();
  if (!fs.existsSync(file)) {
    return null;
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const row = JSON.parse(lines[i]!) as McpIdempotencyRecord;
      if (row.key === key && row.tool === tool) {
        return row;
      }
    } catch {
      // skip
    }
  }
  return null;
}

export function rememberMcpIdempotency(record: McpIdempotencyRecord): void {
  const file = idempotencyPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

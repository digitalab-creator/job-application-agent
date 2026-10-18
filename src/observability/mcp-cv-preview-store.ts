import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type McpCvPreviewRecord = {
  previewId: string;
  workspaceId: string;
  rowNumber: number;
  company: string;
  role: string;
  persona: string;
  headlineId: string;
  cvPath: string;
  createdAt: string;
  expiresAt: string;
};

const PREVIEW_TTL_MS = 30 * 60 * 1000;

function previewStoreDir(): string {
  const ledgerDir = path.dirname(process.env.LEDGER_PATH?.trim() || "/app/data/ledger");
  return path.join(ledgerDir, "mcp-cv-previews");
}

function recordPath(previewId: string): string {
  const safe = previewId.replace(/[^a-f0-9-]/gi, "");
  return path.join(previewStoreDir(), `${safe}.json`);
}

export function storeMcpCvPreview(input: Omit<McpCvPreviewRecord, "previewId" | "createdAt" | "expiresAt">): McpCvPreviewRecord {
  const previewId = randomUUID();
  const createdAt = new Date().toISOString();
  const record: McpCvPreviewRecord = {
    previewId,
    createdAt,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    ...input,
  };
  fs.mkdirSync(previewStoreDir(), { recursive: true });
  fs.writeFileSync(recordPath(previewId), JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
  return record;
}

export function loadMcpCvPreview(workspaceId: string, previewId: string): McpCvPreviewRecord | null {
  const file = recordPath(previewId);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as McpCvPreviewRecord;
    if (record.workspaceId !== workspaceId) {
      return null;
    }
    if (Date.parse(record.expiresAt) < Date.now()) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function publicMcpCvPreviewMeta(record: McpCvPreviewRecord): Record<string, unknown> {
  return {
    previewId: record.previewId,
    workspaceId: record.workspaceId,
    rowNumber: record.rowNumber,
    company: record.company,
    role: record.role,
    persona: record.persona,
    headlineId: record.headlineId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    cvFingerprint: createHash("sha256").update(record.cvPath).digest("hex").slice(0, 16),
  };
}

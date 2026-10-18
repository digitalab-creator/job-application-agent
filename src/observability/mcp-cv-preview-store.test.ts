import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadMcpCvPreview, publicMcpCvPreviewMeta, storeMcpCvPreview } from "./mcp-cv-preview-store.js";

test("CV preview store hides filesystem paths and raw wording", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-cv-prev-"));
  process.env.LEDGER_PATH = path.join(dir, "ledger.jsonl");
  const record = storeMcpCvPreview({
    workspaceId: "internal",
    rowNumber: 42,
    company: "Co",
    role: "Role",
    persona: "technical",
    headlineId: "h1",
    cvPath: "/secret/generated-cv/private.pdf",
  });
  const meta = publicMcpCvPreviewMeta(record);
  assert.equal(typeof meta.previewId, "string");
  assert.equal(meta.cvPath, undefined);
  assert.equal(meta.wording, undefined);
  assert.equal((meta as { cvFingerprint?: string }).cvFingerprint?.length, 16);

  assert.ok(loadMcpCvPreview("internal", record.previewId));
  assert.equal(loadMcpCvPreview("other-workspace", record.previewId), null);
});

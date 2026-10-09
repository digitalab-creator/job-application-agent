import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFreelanceDigestText, newPacksSinceLastDigest, writeDigestPreview } from "./digest.js";
import type { FreelancePackRecord } from "./build-pack.js";

test("digest text includes pack message", () => {
  const pack: FreelancePackRecord = {
    packId: "p1",
    createdAt: new Date().toISOString(),
    opportunityKind: "freelance_project",
    company: "Acme",
    role: "Bot",
    url: "https://example.com",
    budgetHint: "5000",
    whyFit: "fits",
    contactRoute: "x",
    messageDraft: "Hello client",
    portfolioUrl: "https://digitalab.co.il",
    remainingStep: "send",
    state: "ready",
  };
  const text = buildFreelanceDigestText([pack]);
  assert.match(text, /Hello client/);
  assert.match(text, /Acme/);
});

test("preview file written for packs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freelance-digest-"));
  process.env.FREELANCE_PACKS_DIR = dir;
  const packPath = path.join(dir, "pack-a.json");
  fs.writeFileSync(
    packPath,
    JSON.stringify({
      packId: "pack-a",
      createdAt: new Date().toISOString(),
      state: "ready",
      company: "C",
      role: "R",
      url: "",
      budgetHint: "",
      whyFit: "",
      contactRoute: "",
      messageDraft: "Hi",
      portfolioUrl: "https://x",
      remainingStep: "go",
      opportunityKind: "freelance_project",
    }),
  );
  const fresh = newPacksSinceLastDigest();
  assert.equal(fresh.length, 1);
  writeDigestPreview(fresh);
  assert.ok(fs.existsSync(path.join(dir, "latest-digest-preview.txt")));
  delete process.env.FREELANCE_PACKS_DIR;
});

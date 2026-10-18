import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDeployAttestation } from "./run-export.js";

test("resolveDeployAttestation reads mounted release json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-deploy-"));
  const file = path.join(dir, "latest-release.json");
  fs.writeFileSync(file, JSON.stringify({ sha: "abc123def" }));
  const prev = process.env.DEPLOYED_GIT_SHA;
  const prevPath = process.env.DEPLOY_RELEASE_JSON_PATH;
  delete process.env.DEPLOYED_GIT_SHA;
  process.env.DEPLOY_RELEASE_JSON_PATH = file;
  try {
    const att = resolveDeployAttestation();
    assert.equal(att.deployedSha, "abc123def");
    assert.match(att.source, /release_json/);
  } finally {
    if (prev) {
      process.env.DEPLOYED_GIT_SHA = prev;
    } else {
      delete process.env.DEPLOYED_GIT_SHA;
    }
    if (prevPath) {
      process.env.DEPLOY_RELEASE_JSON_PATH = prevPath;
    } else {
      delete process.env.DEPLOY_RELEASE_JSON_PATH;
    }
  }
});

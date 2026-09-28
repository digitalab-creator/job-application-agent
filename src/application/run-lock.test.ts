import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claimApplyRun, releaseApplyRun } from "./run-lock.js";

test("a second claim is refused until the first run releases", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-lock-"));
  const previous = process.env.APPLY_RUN_LOCK_PATH;
  process.env.APPLY_RUN_LOCK_PATH = path.join(dir, "apply-run.lock");
  try {
    assert.deepEqual(claimApplyRun(), { ok: true });
    assert.deepEqual(claimApplyRun(), { ok: false, reason: "apply_run_in_progress" });
    assert.deepEqual(releaseApplyRun(), { ok: true });
    assert.deepEqual(claimApplyRun(), { ok: true });
  } finally {
    if (previous === undefined) {
      delete process.env.APPLY_RUN_LOCK_PATH;
    } else {
      process.env.APPLY_RUN_LOCK_PATH = previous;
    }
  }
});

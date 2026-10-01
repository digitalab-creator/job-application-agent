import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { browserApplyLockHeld, claimBrowserApply, releaseBrowserApply } from "./browser-apply-lock.js";

test("only one browser apply claim is active until release", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-apply-lock-"));
  const previous = process.env.APPLY_BROWSER_LOCK_PATH;
  process.env.APPLY_BROWSER_LOCK_PATH = path.join(dir, "apply-browser.lock");
  try {
    assert.equal(browserApplyLockHeld(), false);
    assert.deepEqual(claimBrowserApply(), { ok: true });
    assert.equal(browserApplyLockHeld(), true);
    assert.deepEqual(claimBrowserApply(), { ok: false, reason: "apply_in_progress" });
    releaseBrowserApply();
    assert.equal(browserApplyLockHeld(), false);
    assert.deepEqual(claimBrowserApply(), { ok: true });
    releaseBrowserApply();
  } finally {
    if (previous === undefined) {
      delete process.env.APPLY_BROWSER_LOCK_PATH;
    } else {
      process.env.APPLY_BROWSER_LOCK_PATH = previous;
    }
  }
});

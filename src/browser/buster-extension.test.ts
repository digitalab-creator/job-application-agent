import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { busterEnabled, busterLaunchArgs, resolveBusterExtensionPath } from "./buster-extension.js";

test("Buster defaults to enabled", () => {
  const previous = process.env.CAPTCHA_BUSTER_ENABLED;
  delete process.env.CAPTCHA_BUSTER_ENABLED;
  try {
    assert.equal(busterEnabled(), true);
    process.env.CAPTCHA_BUSTER_ENABLED = "false";
    assert.equal(busterEnabled(), false);
  } finally {
    if (previous === undefined) {
      delete process.env.CAPTCHA_BUSTER_ENABLED;
    } else {
      process.env.CAPTCHA_BUSTER_ENABLED = previous;
    }
  }
});

test("launch args load only when an unpacked extension exists", () => {
  const previousPath = process.env.BUSTER_EXTENSION_PATH;
  const previousEnabled = process.env.CAPTCHA_BUSTER_ENABLED;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buster-ext-"));
  try {
    process.env.CAPTCHA_BUSTER_ENABLED = "true";
    process.env.BUSTER_EXTENSION_PATH = dir;
    assert.equal(resolveBusterExtensionPath(), null);
    assert.deepEqual(busterLaunchArgs(), []);
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ version: "3.4.0" }));
    assert.equal(resolveBusterExtensionPath(), path.resolve(dir));
    const args = busterLaunchArgs();
    assert.equal(args.length, 2);
    assert.match(args[0]!, /disable-extensions-except=/);
    assert.match(args[1]!, /load-extension=/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (previousPath === undefined) {
      delete process.env.BUSTER_EXTENSION_PATH;
    } else {
      process.env.BUSTER_EXTENSION_PATH = previousPath;
    }
    if (previousEnabled === undefined) {
      delete process.env.CAPTCHA_BUSTER_ENABLED;
    } else {
      process.env.CAPTCHA_BUSTER_ENABLED = previousEnabled;
    }
  }
});

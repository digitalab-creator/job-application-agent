import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hostIsCooling, noteHostSuccess, noteRateLimit } from "./rate-limit.js";

test("rate limit notes a cooldown and success clears it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rate-"));
  const previous = process.env.RATE_LIMIT_STORE_PATH;
  process.env.RATE_LIMIT_STORE_PATH = path.join(dir, "rate-limits.json");
  try {
    assert.equal(hostIsCooling("https://www.linkedin.com/jobs/view/1"), false);
    noteRateLimit("https://www.linkedin.com/jobs/view/1", "429");
    assert.equal(hostIsCooling("linkedin.com"), true);
    noteHostSuccess("linkedin.com");
    assert.equal(hostIsCooling("linkedin.com"), false);
  } finally {
    if (previous === undefined) delete process.env.RATE_LIMIT_STORE_PATH;
    else process.env.RATE_LIMIT_STORE_PATH = previous;
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captchaSolverStatsSnapshot,
  noteActiveCaptchaChallenge,
  noteCaptchaSolverAttempt,
  noteCaptchaSolverOutcome,
} from "./captcha-solver-stats.js";

test("captcha solver stats count buster and 2captcha separately", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-stats-"));
  const previous = process.env.CAPTCHA_SOLVER_STATS_PATH;
  process.env.CAPTCHA_SOLVER_STATS_PATH = path.join(dir, "captcha-solver-stats.json");
  try {
    noteActiveCaptchaChallenge();
    noteCaptchaSolverAttempt("buster");
    noteCaptchaSolverOutcome("buster", false, "buster_timeout");
    noteCaptchaSolverAttempt("2captcha");
    noteCaptchaSolverOutcome("2captcha", true);
    const snap = captchaSolverStatsSnapshot();
    assert.equal(snap.activeChallenges, 1);
    assert.equal(snap.buster.attempts, 1);
    assert.equal(snap.buster.successes, 0);
    assert.equal(snap.buster.failures, 1);
    assert.equal(snap.twoCaptcha.attempts, 1);
    assert.equal(snap.twoCaptcha.successes, 1);
    assert.equal(snap.successRate.buster, 0);
    assert.equal(snap.successRate.twoCaptcha, 100);
    assert.equal(snap.lastSuccessProvider, "2captcha");
    assert.equal(snap.applyOnCaptchaSite.attempts, 0);
  } finally {
    if (previous === undefined) {
      delete process.env.CAPTCHA_SOLVER_STATS_PATH;
    } else {
      process.env.CAPTCHA_SOLVER_STATS_PATH = previous;
    }
  }
});

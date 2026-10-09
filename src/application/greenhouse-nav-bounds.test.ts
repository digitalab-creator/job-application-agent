import assert from "node:assert/strict";
import test from "node:test";
import { greenhouseNavAttemptsPerUrl, greenhouseNavMaxErrorSignals } from "./greenhouse-nav-bounds.js";

test("greenhouse nav bounds default caps", () => {
  delete process.env.GREENHOUSE_NAV_ATTEMPTS_PER_URL;
  delete process.env.GREENHOUSE_NAV_MAX_ERROR_SIGNALS;
  assert.equal(greenhouseNavAttemptsPerUrl(), 2);
  assert.equal(greenhouseNavMaxErrorSignals(), 4);
});

test("greenhouse nav bounds respect env within ceiling", () => {
  process.env.GREENHOUSE_NAV_ATTEMPTS_PER_URL = "9";
  process.env.GREENHOUSE_NAV_MAX_ERROR_SIGNALS = "99";
  assert.equal(greenhouseNavAttemptsPerUrl(), 5);
  assert.equal(greenhouseNavMaxErrorSignals(), 12);
  delete process.env.GREENHOUSE_NAV_ATTEMPTS_PER_URL;
  delete process.env.GREENHOUSE_NAV_MAX_ERROR_SIGNALS;
});

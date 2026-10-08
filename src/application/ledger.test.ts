import assert from "node:assert/strict";
import test from "node:test";
import { isTerminalLedgerEntry, isTerminalManualBlocker, type LedgerEntry } from "./ledger-policy.js";

test("passive captcha ledger rows are terminal", () => {
  const row: LedgerEntry = {
    url: "https://example.com/jobs/1",
    company: "Acme",
    role: "Engineer",
    confirmationDetected: false,
    at: new Date().toISOString(),
    blocker: "captcha",
    captchaSignal: "passive_widget",
  };
  assert.equal(isTerminalManualBlocker(row), true);
});

test("legacy captcha rows without captchaSignal are terminal", () => {
  const row: LedgerEntry = {
    url: "https://example.com/jobs/1",
    company: "Acme",
    role: "Engineer",
    confirmationDetected: false,
    at: new Date().toISOString(),
    blocker: "captcha",
  };
  assert.equal(isTerminalManualBlocker(row), true);
});

test("active_challenge captcha rows are terminal", () => {
  const row: LedgerEntry = {
    url: "https://example.com/jobs/1",
    company: "Acme",
    role: "Engineer",
    confirmationDetected: false,
    at: new Date().toISOString(),
    blocker: "captcha",
    captchaSignal: "active_challenge",
    stage: "post_submit",
  };
  assert.equal(isTerminalManualBlocker(row), true);
});

test("submitted_unconfirmed ledger rows block auto retry", () => {
  const row: LedgerEntry = {
    url: "https://example.com/jobs/1",
    company: "Acme",
    role: "Engineer",
    confirmationDetected: false,
    at: new Date().toISOString(),
    blocker: "submitted_unconfirmed",
    stage: "post_submit",
  };
  assert.equal(isTerminalLedgerEntry(row), true);
});

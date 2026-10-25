import assert from "node:assert/strict";
import test from "node:test";
import { greenhouseOtpFailureHint } from "./greenhouse-otp-diagnostics.js";

test("greenhouseOtpFailureHint never embeds raw codes", () => {
  const hint = greenhouseOtpFailureHint("gmail_authorization_failed");
  assert.match(hint, /Gmail/i);
  assert.equal(hint.includes("AB12"), false);
});

test("greenhouseOtpFailureHint distinguishes native gmail vs webhook", () => {
  const gmail = greenhouseOtpFailureHint("no_matching_message");
  const webhook = greenhouseOtpFailureHint("webhook_misconfigured");
  assert.notEqual(gmail, webhook);
  assert.match(webhook, /webhook/i);
});

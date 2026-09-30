import assert from "node:assert/strict";
import test from "node:test";
import { captchaSignalFromFrameUrls } from "./captcha-signal.js";

test("invisible recaptcha iframe is passive_widget not active_challenge", () => {
  const signal = captchaSignalFromFrameUrls([
    "https://www.recaptcha.net/recaptcha/enterprise/anchor?size=invisible",
  ]);
  assert.equal(signal, "passive_widget");
});

test("recaptcha bframe is active_challenge", () => {
  const signal = captchaSignalFromFrameUrls([
    "https://www.recaptcha.net/recaptcha/enterprise/bframe?size=normal",
  ]);
  assert.equal(signal, "active_challenge");
});

test("no captcha urls is none", () => {
  assert.equal(captchaSignalFromFrameUrls(["https://job-boards.greenhouse.io/embed/job_app"]), "none");
});

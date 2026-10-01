import assert from "node:assert/strict";
import test from "node:test";
import { classifyGreenhouseSubmitText, greenhouseFrameSignals } from "./greenhouse-post-submit.js";

test("classifyGreenhouseSubmitText sees a security code step", () => {
  const text = "A verification code was sent to you. Enter the 8-character code. Security code";
  assert.equal(classifyGreenhouseSubmitText(text), "email_verification");
});

test("classifyGreenhouseSubmitText sees a phone validation error", () => {
  const text = "Phone* Phone number is too short Resume/CV* Privacy Policy Submit application";
  assert.equal(classifyGreenhouseSubmitText(text), "validation");
});

test("classifyGreenhouseSubmitText sees the form still waiting for submit", () => {
  const text = "First Name Email Resume/CV Privacy Policy Submit application";
  assert.equal(classifyGreenhouseSubmitText(text), "form_still_open");
});

test("classifyGreenhouseSubmitText sees a thank-you as confirmed", () => {
  assert.equal(classifyGreenhouseSubmitText("Thanks for applying to Orca Security"), "confirmed");
});

test("job description requirements do not fake a validation error when submit is still visible", () => {
  const jd =
    "Data Engineer Tel Aviv Apply Similarweb is growing. Bachelor degree is required for this role. Submit application First Name";
  assert.equal(classifyGreenhouseSubmitText(jd), "form_still_open");
});

test("greenhouseFrameSignals marks invisible recaptcha and CHEQ", () => {
  const signals = greenhouseFrameSignals([
    "https://www.recaptcha.net/recaptcha/enterprise/anchor?size=invisible",
    "https://orca.security/cheq-ppc-invalid-users",
  ]);
  assert.equal(signals.recaptcha, "invisible");
  assert.equal(signals.cheqInvalid, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseGreenhouseOtpFromText } from "./greenhouse-otp.js";

test("parseGreenhouseOtpFromText finds 8-character verification code", () => {
  const body = "Your verification code is AB12cd34. Enter the 8-character code to confirm you're a human.";
  assert.equal(parseGreenhouseOtpFromText(body), "AB12cd34");
});

test("parseGreenhouseOtpFromText reads Greenhouse security-code email wording", () => {
  const body = "Copy and paste this code into the security code field on your application: AB12cd34. After you enter the code, resubmit your application.";
  assert.equal(parseGreenhouseOtpFromText(body), "AB12cd34");
});

test("parseGreenhouseOtpFromText reads security code label", () => {
  const body = "Security code: ZZ99xx88";
  assert.equal(parseGreenhouseOtpFromText(body), "ZZ99xx88");
});

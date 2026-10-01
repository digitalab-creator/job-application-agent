import { thankYouMatch } from "./thank-you.js";

export type GreenhouseSubmitKind = "confirmed" | "email_verification" | "validation" | "form_still_open" | "unknown";

export type GreenhouseFrameSignals = {
  recaptcha: "none" | "invisible" | "challenge";
  cheqInvalid: boolean;
};

const FORM_ERROR_LINE =
  /(?:^|\*)(?:[^.\n]{0,90})(?:is required|please complete|invalid phone|enter a valid|too short|too long|this field is required)/i;

/** What the Greenhouse embed is showing after a submit click. */
export function classifyGreenhouseSubmitText(text: string): GreenhouseSubmitKind {
  if (thankYouMatch(text)) {
    return "confirmed";
  }
  if (/security code|verification code was sent|enter the \d+-character code|confirm you'?re a human/i.test(text)) {
    return "email_verification";
  }
  const hasSubmitButton = /submit application/i.test(text);
  const errorLines = text
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && line.length < 160 && FORM_ERROR_LINE.test(line));
  if (errorLines.length > 0) {
    return "validation";
  }
  if (hasSubmitButton) {
    return "form_still_open";
  }
  if (/too short|too long|please complete|invalid phone|enter a valid|this field is required/i.test(text)) {
    return "validation";
  }
  return "unknown";
}

/** reCAPTCHA inside the Greenhouse iframe is invisible until a challenge appears. CHEQ is Orca's bot wall. */
export function greenhouseFrameSignals(urls: string[]): GreenhouseFrameSignals {
  const recaptchaUrls = urls.filter((url) => /recaptcha/i.test(url));
  let recaptcha: GreenhouseFrameSignals["recaptcha"] = "none";
  if (recaptchaUrls.some((url) => /bframe|size=normal|size=compact/i.test(url))) {
    recaptcha = "challenge";
  } else if (recaptchaUrls.length > 0) {
    recaptcha = "invisible";
  }
  return {
    recaptcha,
    cheqInvalid: urls.some((url) => /cheq-ppc-invalid-users/i.test(url)),
  };
}

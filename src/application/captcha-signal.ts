import { greenhouseFrameSignals } from "./greenhouse-post-submit.js";

export type CaptchaSignal = "none" | "passive_widget" | "active_challenge";

/** Classify CAPTCHA from frame/iframe URLs only (Greenhouse-aligned). */
export function captchaSignalFromFrameUrls(urls: string[]): CaptchaSignal {
  const { recaptcha } = greenhouseFrameSignals(urls);
  if (recaptcha === "challenge") {
    return "active_challenge";
  }
  const hcaptchaUrls = urls.filter((url) => /hcaptcha/i.test(url));
  if (hcaptchaUrls.some((url) => /challenge|#frame=challenge|hcaptcha\.com\/1\/api\.js\?.*challenge/i.test(url))) {
    return "active_challenge";
  }
  const recaptchaUrls = urls.filter((url) => /recaptcha/i.test(url));
  if (recaptcha === "invisible" || recaptchaUrls.length > 0 || hcaptchaUrls.length > 0) {
    return "passive_widget";
  }
  return "none";
}

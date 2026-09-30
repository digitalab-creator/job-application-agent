import type { Page } from "playwright";
import { captchaSignalFromFrameUrls, type CaptchaSignal } from "./captcha-signal.js";
import { detectGreenhouseConfirmation } from "./greenhouse.js";
import { looksLikeLoginWall } from "./login-wall.js";
import { thankYouMatch } from "./thank-you.js";

export type { CaptchaSignal } from "./captcha-signal.js";

export async function classifyCaptchaSignal(page: Page): Promise<CaptchaSignal> {
  const urls = await collectFrameAndIframeUrls(page);
  const fromFrames = captchaSignalFromFrameUrls(urls);
  if (fromFrames === "active_challenge") {
    return "active_challenge";
  }
  if (await visibleRecaptchaChallengeFrame(page)) {
    return "active_challenge";
  }
  const text = await page.locator("body").innerText().catch(() => "");
  if (activeChallengePrompt(text)) {
    return "active_challenge";
  }
  if (fromFrames === "passive_widget") {
    return "passive_widget";
  }
  if (await passiveCaptchaWidgetPresent(page)) {
    return "passive_widget";
  }
  return "none";
}

/** @deprecated Use classifyCaptchaSignal() === "active_challenge" */
export async function detectCaptcha(page: Page): Promise<boolean> {
  return (await classifyCaptchaSignal(page)) === "active_challenge";
}

export async function detectEmailVerification(page: Page): Promise<boolean> {
  const chunks: string[] = [];
  chunks.push(await page.locator("body").innerText().catch(() => ""));
  for (const frame of page.frames()) {
    chunks.push(await frame.locator("body").innerText().catch(() => ""));
  }
  const text = chunks.join("\n");
  return /verification code was sent|enter the \d+-character code|confirm you'?re a human|security code/i.test(text);
}

export async function detectLoginWall(page: Page): Promise<boolean> {
  const scopes = [page, ...page.frames()];
  let hasPassword = false;
  let hasEmail = false;
  let hasResumeFile = false;
  const chunks: string[] = [];
  for (const scope of scopes) {
    hasPassword = hasPassword || (await scope.locator('input[type="password"]').count().catch(() => 0)) > 0;
    hasEmail = hasEmail || (await scope.locator('input[type="email"]').count().catch(() => 0)) > 0;
    hasResumeFile = hasResumeFile || (await scope.locator('input[type="file"]').count().catch(() => 0)) > 0;
    chunks.push(await scope.locator("body").innerText().catch(() => ""));
  }
  const title = await page.title().catch(() => "");
  return looksLikeLoginWall({
    url: page.url(),
    title,
    text: chunks.join("\n"),
    hasPassword,
    hasEmail,
    hasResumeFile,
  });
}

export async function detectConfirmation(page: Page): Promise<{ ok: boolean; phrase: string }> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const greenhouse = await detectGreenhouseConfirmation(page);
    if (greenhouse.ok) {
      return greenhouse;
    }
    const fraction = attempt / 11;
    await page.evaluate((y) => window.scrollTo(0, document.body.scrollHeight * y), fraction).catch(() => undefined);
    const phrase = await confirmationPhrase(page);
    if (phrase) {
      return { ok: true, phrase };
    }
    await page.waitForTimeout(1200);
  }
  return { ok: false, phrase: "" };
}

async function confirmationPhrase(page: Page): Promise<string | null> {
  const chunks: string[] = [page.url()];
  chunks.push(await page.locator("body").innerText().catch(() => ""));
  for (const frame of page.frames()) {
    chunks.push(await frame.locator("body").innerText().catch(() => ""));
  }
  const heading = await page.locator("h1, h2, [role='alert'], [class*='thank'], [class*='success'], .elementor-message-success").allInnerTexts().catch(() => []);
  chunks.push(...heading);
  return thankYouMatch(chunks.join("\n"), page.url());
}

async function collectFrameAndIframeUrls(page: Page): Promise<string[]> {
  const urls = page.frames().map((frame) => frame.url());
  const iframeSrcs = await page.evaluate(() => (
    Array.from(document.querySelectorAll("iframe[src]")).map((node) => (node as HTMLIFrameElement).src)
  )).catch(() => []);
  return [...urls, ...iframeSrcs];
}

async function visibleRecaptchaChallengeFrame(page: Page): Promise<boolean> {
  const loc = page.locator('iframe[src*="recaptcha"][src*="bframe"], iframe[title*="recaptcha challenge" i]');
  const count = await loc.count().catch(() => 0);
  if (count === 0) {
    return false;
  }
  return loc.first().isVisible().catch(() => false);
}

async function passiveCaptchaWidgetPresent(page: Page): Promise<boolean> {
  const widgets = await page.locator(
    'iframe[src*="recaptcha"]:not([src*="bframe"]), iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha',
  ).count();
  if (widgets > 0) {
    return true;
  }
  for (const frame of page.frames()) {
    const nested = await frame.locator(
      'iframe[src*="recaptcha"]:not([src*="bframe"]), iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha',
    ).count().catch(() => 0);
    if (nested > 0) {
      return true;
    }
  }
  return false;
}

function activeChallengePrompt(text: string): boolean {
  return /complete the captcha|verify you are human|select all (squares|images)|solve the challenge|answer validation task|protected by hcaptcha.*challenge/i.test(text);
}

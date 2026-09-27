import type { Page } from "playwright";
import { thankYouMatch } from "./thank-you.js";

export async function detectCaptcha(page: Page): Promise<boolean> {
  const widgets = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha').count();
  if (widgets > 0) {
    return true;
  }
  const text = await page.locator("body").innerText().catch(() => "");
  return /verify you are human|i'?m not a robot|complete the captcha|answer validation task/i.test(text);
}

export async function detectLoginWall(page: Page): Promise<boolean> {
  const passwords = await page.locator('input[type="password"]').count();
  if (passwords === 0) {
    return false;
  }
  const text = await page.locator("body").innerText().catch(() => "");
  return /sign in|log in|create an account|create your account/i.test(text);
}

export async function detectConfirmation(page: Page): Promise<{ ok: boolean; phrase: string }> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const fraction = attempt / 9;
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
  const heading = await page.locator("h1, h2, [role='alert'], [class*='thank'], [class*='success']").allInnerTexts().catch(() => []);
  chunks.push(...heading);
  return thankYouMatch(chunks.join("\n"), page.url());
}

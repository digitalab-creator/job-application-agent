import type { Page } from "playwright";

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

export async function detectConfirmation(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
    if (await detectConfirmationOnce(page)) {
      return true;
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

async function detectConfirmationOnce(page: Page): Promise<boolean> {
  const visible = await page.locator("body").innerText().catch(() => "");
  const html = await page.content().catch(() => "");
  const text = `${visible}\n${html}`;
  const url = page.url();
  const saidThanks = /thank you|thanks for applying|your application has been submitted|application (has been |was )?(received|submitted)|successfully submitted|we (have )?received your application|your application has been sent/i.test(text);
  const urlSays = /thank|confirmation|application-submitted|success/i.test(url);
  return saidThanks || urlSays;
}

import type { Page } from "playwright";
import { thankYouMatch } from "./thank-you.js";

/** Comeet / Angular apply() often keeps the same URL — success is a banner or modal, not navigation. */
export async function detectComeetConfirmation(page: Page): Promise<{ ok: boolean; phrase: string }> {
  const scopes = [page, ...page.frames()];
  const chunks: string[] = [page.url()];
  for (const scope of scopes) {
    chunks.push(await scope.locator("body").innerText().catch(() => ""));
    const alerts = await scope.locator(
      "[class*='success'], [class*='thank'], [class*='submitted'], .alert-success, [role='alert'], [data-automation='application-success']",
    ).allInnerTexts().catch(() => []);
    chunks.push(...alerts);
  }
  const text = chunks.join("\n");
  const phrase = thankYouMatch(text, page.url());
  if (phrase) {
    return { ok: true, phrase };
  }
  if (/application (was )?sent|successfully applied|we received your application|המועמדות.*התקבלה|הבקשה נשלחה/i.test(text)) {
    const match = text.match(/application (was )?sent|successfully applied|we received your application|המועמדות[^\n]{0,40}התקבלה|הבקשה נשלחה/i);
    return { ok: true, phrase: match?.[0]?.trim() ?? "comeet_success_banner" };
  }
  const applyGone = await page.locator('button:has-text("Submit Application"), button:has-text("Apply")').count().catch(() => 0);
  const successNodes = await page.locator("[class*='success'], [class*='thank']").count().catch(() => 0);
  if (applyGone === 0 && successNodes > 0 && thankYouMatch(text)) {
    return { ok: true, phrase: "comeet_ui_success" };
  }
  return { ok: false, phrase: "" };
}

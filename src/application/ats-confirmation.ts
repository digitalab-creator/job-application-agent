import type { Page } from "playwright";
import { thankYouMatch } from "./thank-you.js";

/** SmartRecruiters oneclick-ui keeps the same URL; success copy often lives in shadow roots. */
export async function detectSmartRecruitersConfirmation(page: Page): Promise<{ ok: boolean; phrase: string }> {
  if (!/smartrecruiters\.com/i.test(page.url())) {
    return { ok: false, phrase: "" };
  }
  const text = await page.evaluate(() => {
    const parts: string[] = [document.body?.innerText ?? ""];
    const walk = (root: Document | ShadowRoot | Element) => {
      const children = root instanceof Document
        ? Array.from(root.body?.children ?? [])
        : Array.from((root as ShadowRoot | Element).children ?? []);
      for (const child of children) {
        if (child instanceof HTMLElement) {
          if (child.shadowRoot) {
            walk(child.shadowRoot);
          }
          const visible = child.innerText?.trim();
          if (visible) {
            parts.push(visible);
          }
        }
      }
    };
    walk(document);
    return parts.join("\n");
  }).catch(() => "");
  const phrase = thankYouMatch(text, page.url());
  if (phrase) {
    return { ok: true, phrase };
  }
  if (/application (has been |was )?submitted|thanks for applying|thank you for applying|we received your application|you applied successfully|already applied/i.test(text)) {
    const match = text.match(/application (has been |was )?submitted|thanks for applying|thank you for applying|we received your application|you applied successfully|already applied/i);
    return { ok: true, phrase: match?.[0]?.trim() ?? "smartrecruiters_success" };
  }
  const submitButtons = await page.getByRole("button", { name: /submit|send application|apply/i }).count().catch(() => 0);
  if (submitButtons === 0 && /thank|success|submitted|received/i.test(text)) {
    return { ok: true, phrase: "smartrecruiters_ui_success" };
  }
  return { ok: false, phrase: "" };
}

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

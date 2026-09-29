import type { Frame, Locator, Page } from "playwright";
import { classifyGreenhouseSubmitText, greenhouseFrameSignals, type GreenhouseFrameSignals, type GreenhouseSubmitKind } from "./greenhouse-post-submit.js";
import { thankYouMatch } from "./thank-you.js";

export type GreenhouseAfterSubmit = GreenhouseFrameSignals & {
  kind: GreenhouseSubmitKind;
  excerpt: string;
};

export async function inspectGreenhouseAfterSubmit(page: Page): Promise<GreenhouseAfterSubmit> {
  const urls = page.frames().map((frame) => frame.url());
  const frame = greenhouseJobAppFrame(page);
  const text = frame
    ? (await frame.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim()
    : "";
  return {
    kind: classifyGreenhouseSubmitText(text),
    excerpt: text.slice(0, 500),
    ...greenhouseFrameSignals(urls),
  };
}

export async function scrollGreenhouseFormIntoView(page: Page): Promise<void> {
  const frame = page.locator("iframe[src*='greenhouse']").first();
  if (await frame.count().catch(() => 0)) {
    await frame.scrollIntoViewIfNeeded().catch(() => undefined);
  }
}

async function pickGreenhouseCombobox(frame: Frame, input: Locator, value: string): Promise<void> {
  await input.click({ timeout: 5000, force: true }).catch(() => undefined);
  await input.fill(value);
  const option = frame.locator('div[role="option"]').filter({ hasText: new RegExp(`^${value}$`, "i") }).first();
  if (await option.count().catch(() => 0)) {
    await option.click({ timeout: 5000 }).catch(() => undefined);
  } else {
    await input.press("ArrowDown").catch(() => undefined);
    await input.press("Enter").catch(() => undefined);
  }
  await frame.waitForTimeout(400);
}

/** Greenhouse embed on company sites (Orca, etc.) — not the legacy `/apply?` Comeet path. */
export function greenhouseJobAppFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => /greenhouse\.io\/embed\/job_app/i.test(frame.url()));
}

/** Greenhouse embed uses React comboboxes for country and legal consent — plain .fill() is not enough. */
export async function enterGreenhouseSecurityCode(page: Page, code: string): Promise<boolean> {
  const frame = greenhouseJobAppFrame(page);
  if (!frame) {
    return false;
  }
  const target = frame.getByLabel(/security code/i).first();
  if ((await target.count().catch(() => 0)) === 0) {
    return false;
  }
  await target.click({ timeout: 5000, force: true }).catch(() => undefined);
  await target.fill("");
  await target.pressSequentially(code, { delay: 50 });
  await target.press("Tab").catch(() => undefined);
  const submit = frame.getByRole("button", { name: /submit application/i }).first();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await submit.isEnabled().catch(() => false)) {
      return true;
    }
    await frame.waitForTimeout(250);
  }
  return true;
}

export async function finalizeGreenhouseApplyForm(frame: Frame): Promise<void> {
  const country = frame.locator("#country");
  if (await country.count().catch(() => 0)) {
    await pickGreenhouseCombobox(frame, country, "Israel");
  }

  const consent = frame
    .locator(".field")
    .filter({ hasText: /store and process my data/i })
    .locator('input[role="combobox"]')
    .first();
  if (await consent.count().catch(() => 0)) {
    await pickGreenhouseCombobox(frame, consent, "Yes");
  }
}

export async function detectGreenhouseConfirmation(page: Page): Promise<{ ok: boolean; phrase: string }> {
  for (const frame of page.frames()) {
    if (!/greenhouse\.io/i.test(frame.url())) {
      continue;
    }
    if (/application_id=/i.test(frame.url())) {
      return { ok: true, phrase: "greenhouse_application_id" };
    }
  }

  for (const frame of page.frames()) {
    if (!/greenhouse\.io/i.test(frame.url())) {
      continue;
    }
    const confirmation = frame.locator("#application_confirmation, [class*='confirmation'], [id*='confirmation']");
    if (await confirmation.count().catch(() => 0)) {
      const text = await confirmation.first().innerText().catch(() => "");
      const phrase = thankYouMatch(text, frame.url()) ?? text.replace(/\s+/g, " ").trim().slice(0, 180);
      if (phrase) {
        return { ok: true, phrase };
      }
    }

    const body = await frame.locator("body").innerText().catch(() => "");
    const phrase = thankYouMatch(body, frame.url());
    if (phrase) {
      return { ok: true, phrase };
    }

    if (/select\.\.\./i.test(body) === false && /submit application/i.test(body) === false && /thank|received your application|successfully applied/i.test(body)) {
      const match = body.match(/thank[^\n]{0,120}|received your application|successfully applied/i);
      if (match) {
        return { ok: true, phrase: match[0].trim() };
      }
    }

    const submitButtons = await frame.getByRole("button", { name: /submit application/i }).count().catch(() => 0);
    if (submitButtons === 0 && /already applied|previously applied|application has been received|we received your application/i.test(body)) {
      const match = body.match(/already applied|previously applied|application has been received|we received your application/i);
      return { ok: true, phrase: match?.[0] ?? "greenhouse_post_submit" };
    }
  }

  return { ok: false, phrase: "" };
}

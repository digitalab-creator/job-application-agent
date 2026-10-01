import type { Frame, Locator, Page } from "playwright";
import type { AnswerRecord } from "../models/types.js";
import { classifyGreenhouseSubmitText, greenhouseFrameSignals, type GreenhouseFrameSignals, type GreenhouseSubmitKind } from "./greenhouse-post-submit.js";
import { thankYouMatch } from "./thank-you.js";
import { candidate } from "../config/candidate.js";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function pickGreenhouseCombobox(frame: Frame, input: Locator, value: string): Promise<void> {
  await input.click({ timeout: 5000, force: true }).catch(() => undefined);
  await input.fill("");
  await input.fill(value, { timeout: 5000 }).catch(() => undefined);
  const exact = frame.locator('div[role="option"]').filter({ hasText: new RegExp(`^${escapeRegExp(value)}$`, "i") }).first();
  const partial = frame.locator('div[role="option"]').filter({ hasText: new RegExp(escapeRegExp(value.slice(0, 40)), "i") }).first();
  const option = (await exact.count().catch(() => 0)) ? exact : partial;
  if (await option.count().catch(() => 0)) {
    await option.click({ timeout: 5000 }).catch(() => undefined);
  } else {
    await input.press("ArrowDown").catch(() => undefined);
    await input.press("Enter").catch(() => undefined);
  }
  await frame.waitForTimeout(400);
}

function questionNeedle(question: string): string {
  return escapeRegExp(question.replace(/\*+$/, "").trim().slice(0, 55));
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

export async function finalizeGreenhouseApplyForm(
  frame: Frame,
  answers: AnswerRecord[] = [],
  extras: { portfolioUrl?: string } = {},
): Promise<void> {
  const country = frame.locator("#country");
  if (await country.count().catch(() => 0)) {
    await pickGreenhouseCombobox(frame, country, candidate.location.country);
  }

  const city = frame.locator("#candidate-location, input[name*='location' i], input[aria-label*='City' i]").first();
  if (await city.count().catch(() => 0)) {
    await pickGreenhouseCombobox(frame, city, candidate.location.city);
  }

  const portfolioUrl = extras.portfolioUrl?.trim()
    || candidate.portfolio.build
    || candidate.portfolio.automation;
  const website = frame.locator(
    'input[name="job_application[website]"], #job_application_website, input[name*="website" i], input[aria-label*="Website" i]',
  ).first();
  if (portfolioUrl && (await website.count().catch(() => 0))) {
    await website.click({ timeout: 3000, force: true }).catch(() => undefined);
    await website.fill(portfolioUrl);
    await website.press("Tab").catch(() => undefined);
  }

  const consent = frame
    .locator(".field")
    .filter({ hasText: /store and process my data/i })
    .locator('input[role="combobox"]')
    .first();
  if (await consent.count().catch(() => 0)) {
    await pickGreenhouseCombobox(frame, consent, "Yes");
  }

  for (const record of answers) {
    const q = record.question.replace(/\*+$/, "").trim();
    if (!q || q.length < 4) {
      continue;
    }
    if (/first name|last name|preferred first|email|phone|linkedin|attach|country|location \(city\)/i.test(q)) {
      continue;
    }
    const needle = questionNeedle(q);
    const fieldBlock = frame.locator(".field, .application-field, .select__container").filter({ hasText: new RegExp(needle, "i") }).first();
    if (!(await fieldBlock.count().catch(() => 0))) {
      continue;
    }
    const combobox = fieldBlock.locator('input[role="combobox"]').first();
    if (await combobox.count().catch(() => 0)) {
      await pickGreenhouseCombobox(frame, combobox, record.answer);
      continue;
    }
    const textarea = fieldBlock.locator("textarea").first();
    if (await textarea.count().catch(() => 0)) {
      await textarea.fill(record.answer);
      continue;
    }
    const textInput = fieldBlock.locator('input[type="text"]:not([type="hidden"])').first();
    if (await textInput.count().catch(() => 0)) {
      await textInput.fill(record.answer);
      await textInput.press("Tab").catch(() => undefined);
    }
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

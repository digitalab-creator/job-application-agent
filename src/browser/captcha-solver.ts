import type { Frame, Page } from "playwright";
import { log } from "../logging/logger.js";
import {
  noteActiveCaptchaChallenge,
  noteCaptchaSolverAttempt,
  noteCaptchaSolverOutcome,
  type CaptchaSolverProvider,
} from "../application/captcha-solver-stats.js";
import { noteRateLimit } from "../application/rate-limit.js";
import { check2CaptchaBudget, record2CaptchaSpend } from "../application/captcha-solver-budget.js";
import { resolveBusterExtensionPath } from "./buster-extension.js";

export type CaptchaSolveResult = {
  ok: boolean;
  reason: string;
  provider?: CaptchaSolverProvider;
};

const MAX_ILS = () => {
  const n = Number(process.env.CAPTCHA_MAX_ILS_PER_JOB ?? "2");
  return Number.isFinite(n) && n > 0 ? n : 2;
};

const BUSTER_BUTTON_WAIT_MS = 20_000;
const BUSTER_SOLVE_TIMEOUT_MS = 180_000;
const BUSTER_POLL_MS = 2_000;

/**
 * Active challenge solver chain:
 * 1. [Buster](https://github.com/dessant/buster) audio path in the browser
 * 2. 2captcha token API only when Buster fails or is unavailable
 */
export async function trySolveActiveCaptcha(page: Page, pageUrl: string): Promise<CaptchaSolveResult> {
  noteActiveCaptchaChallenge();
  const buster = await trySolveWithBuster(page, pageUrl);
  if (buster.ok) {
    return buster;
  }
  log("CAPTCHA_BUSTER_FALLBACK_2CAPTCHA", { url: pageUrl, reason: buster.reason });
  return trySolveWith2Captcha(page, pageUrl, buster.reason);
}

async function trySolveWithBuster(page: Page, pageUrl: string): Promise<CaptchaSolveResult> {
  const extensionPath = resolveBusterExtensionPath();
  if (!extensionPath) {
    log("CAPTCHA_BUSTER_UNAVAILABLE", { url: pageUrl, reason: "extension_missing_or_disabled" });
    return { ok: false, reason: "buster_unavailable" };
  }
  noteCaptchaSolverAttempt("buster");
  try {
    await openRecaptchaChallenge(page);
    const buttonFrame = await waitForBusterButton(page, BUSTER_BUTTON_WAIT_MS);
    if (!buttonFrame) {
      log("CAPTCHA_BUSTER_BUTTON_MISSING", { url: pageUrl });
      noteCaptchaSolverOutcome("buster", false, "buster_button_missing");
      return { ok: false, reason: "buster_button_missing" };
    }
    await buttonFrame.locator("#solver-button").first().click({ force: true, timeout: 5_000 });
    log("CAPTCHA_BUSTER_CLICKED", { url: pageUrl });
    const deadline = Date.now() + BUSTER_SOLVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await pageHasRecaptchaSuccess(page)) {
        log("CAPTCHA_SOLVER_OK", { provider: "buster", url: pageUrl });
        noteCaptchaSolverOutcome("buster", true);
        return { ok: true, reason: "buster", provider: "buster" };
      }
      await page.waitForTimeout(BUSTER_POLL_MS);
    }
    log("CAPTCHA_BUSTER_TIMEOUT", { url: pageUrl, budgetIls: MAX_ILS() });
    noteCaptchaSolverOutcome("buster", false, "buster_timeout");
    return { ok: false, reason: "buster_timeout" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "buster_failed";
    log("CAPTCHA_BUSTER_FAILED", { message: message.slice(0, 200), url: pageUrl });
    noteCaptchaSolverOutcome("buster", false, message);
    return { ok: false, reason: message.slice(0, 200) };
  }
}

async function trySolveWith2Captcha(
  page: Page,
  pageUrl: string,
  priorReason: string,
): Promise<CaptchaSolveResult> {
  const apiKey = process.env.CAPTCHA_SOLVER_API_KEY?.trim();
  if (!apiKey) {
    log("CAPTCHA_SOLVER_UNCONFIGURED", { url: pageUrl, after: priorReason });
    return { ok: false, reason: `buster_failed:${priorReason};2captcha_unconfigured` };
  }
  const sitekey = await readSiteKey(page);
  if (!sitekey) {
    return { ok: false, reason: `buster_failed:${priorReason};sitekey_not_found` };
  }
  const budget = check2CaptchaBudget(pageUrl);
  if (!budget.ok) {
    log("CAPTCHA_2CAPTCHA_BUDGET_BLOCKED", { url: pageUrl, reason: budget.reason });
    return { ok: false, reason: `buster_failed:${priorReason};${budget.reason}` };
  }
  noteCaptchaSolverAttempt("2captcha");
  try {
    const token = await solve2Captcha(apiKey, sitekey, pageUrl);
    await injectRecaptchaToken(page, token);
    record2CaptchaSpend(pageUrl, "active_challenge_solved");
    log("CAPTCHA_SOLVER_OK", { provider: "2captcha", url: pageUrl, after: priorReason });
    noteCaptchaSolverOutcome("2captcha", true);
    return { ok: true, reason: "2captcha", provider: "2captcha" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "solver_failed";
    if (/rate|429|too many/i.test(message)) {
      noteRateLimit(pageUrl, `captcha_solver:${message.slice(0, 120)}`);
    }
    log("CAPTCHA_SOLVER_FAILED", { message, url: pageUrl, budgetIls: MAX_ILS(), after: priorReason });
    noteCaptchaSolverOutcome("2captcha", false, message);
    return { ok: false, reason: `buster_failed:${priorReason};${message.slice(0, 160)}` };
  }
}

async function openRecaptchaChallenge(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const checkbox = frame.locator("#recaptcha-anchor, .recaptcha-checkbox-border");
    if (await checkbox.count().catch(() => 0) === 0) {
      continue;
    }
    const checked = await frame.locator(".recaptcha-checkbox-checked").count().catch(() => 0);
    if (checked > 0) {
      return;
    }
    await checkbox.first().click({ force: true, timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(1_200);
    return;
  }
}

async function waitForBusterButton(page: Page, timeoutMs: number): Promise<Frame | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const count = await frame.locator("#solver-button").count().catch(() => 0);
      if (count > 0) {
        return frame;
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function pageHasRecaptchaSuccess(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const checked = await frame.locator(".recaptcha-checkbox-checked").count().catch(() => 0);
    if (checked > 0) {
      return true;
    }
  }
  const token = await page.evaluate(() => {
    const areas = Array.from(
      document.querySelectorAll<HTMLTextAreaElement>("textarea[name='g-recaptcha-response'], #g-recaptcha-response"),
    );
    return areas.some((node) => (node.value || "").trim().length > 20);
  }).catch(() => false);
  return Boolean(token);
}

async function readSiteKey(page: Page): Promise<string | null> {
  const fromDom = await page.evaluate(() => {
    const node = document.querySelector("[data-sitekey]");
    const key = node?.getAttribute("data-sitekey");
    if (key) return key;
    const iframe = document.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha']") as HTMLIFrameElement | null;
    if (!iframe?.src) return null;
    try {
      return new URL(iframe.src).searchParams.get("k") || new URL(iframe.src).searchParams.get("sitekey");
    } catch {
      return null;
    }
  });
  return fromDom;
}

async function solve2Captcha(apiKey: string, sitekey: string, pageUrl: string): Promise<string> {
  const start = await fetch("https://2captcha.com/in.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      key: apiKey,
      method: "userrecaptcha",
      googlekey: sitekey,
      pageurl: pageUrl,
      json: "1",
    }),
  });
  const started = await start.json() as { status?: number; request?: string };
  if (started.status !== 1 || !started.request) {
    throw new Error(started.request || "2captcha_submit_failed");
  }
  const id = started.request;
  for (let i = 0; i < 24; i += 1) {
    await sleep(5_000);
    const poll = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(id)}&json=1`,
    );
    const body = await poll.json() as { status?: number; request?: string };
    if (body.status === 1 && body.request) {
      return body.request;
    }
    if (body.request && body.request !== "CAPCHA_NOT_READY") {
      throw new Error(body.request);
    }
  }
  throw new Error("2captcha_timeout");
}

async function injectRecaptchaToken(page: Page, token: string): Promise<void> {
  await page.evaluate((value) => {
    const areas = document.querySelectorAll("textarea[name='g-recaptcha-response'], #g-recaptcha-response");
    areas.forEach((node) => {
      (node as HTMLTextAreaElement).value = value;
    });
    const cfg = (window as unknown as {
      ___grecaptcha_cfg?: { clients?: Record<string, unknown> };
    }).___grecaptcha_cfg;
    void cfg;
  }, token);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

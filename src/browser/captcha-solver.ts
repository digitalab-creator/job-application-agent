import type { Page } from "playwright";
import { log } from "../logging/logger.js";
import { noteRateLimit } from "../application/rate-limit.js";

const MAX_ILS = () => {
  const n = Number(process.env.CAPTCHA_MAX_ILS_PER_JOB ?? "2");
  return Number.isFinite(n) && n > 0 ? n : 2;
};

/**
 * Ask a solver for a token when an active challenge is on screen.
 * Adapts when the solver itself rate-limits us.
 */
export async function trySolveActiveCaptcha(page: Page, pageUrl: string): Promise<{ ok: boolean; reason: string }> {
  const apiKey = process.env.CAPTCHA_SOLVER_API_KEY?.trim();
  if (!apiKey) {
    log("CAPTCHA_SOLVER_UNCONFIGURED", { url: pageUrl });
    return { ok: false, reason: "solver_unconfigured" };
  }
  const sitekey = await readSiteKey(page);
  if (!sitekey) {
    return { ok: false, reason: "sitekey_not_found" };
  }
  const provider = (process.env.CAPTCHA_SOLVER_PROVIDER ?? "2captcha").toLowerCase();
  try {
    const token = provider === "2captcha"
      ? await solve2Captcha(apiKey, sitekey, pageUrl)
      : await solve2Captcha(apiKey, sitekey, pageUrl);
    await injectRecaptchaToken(page, token);
    log("CAPTCHA_SOLVER_OK", { provider, url: pageUrl });
    return { ok: true, reason: "solved" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "solver_failed";
    if (/rate|429|too many/i.test(message)) {
      noteRateLimit(pageUrl, `captcha_solver:${message.slice(0, 120)}`);
    }
    log("CAPTCHA_SOLVER_FAILED", { message, url: pageUrl, budgetIls: MAX_ILS() });
    return { ok: false, reason: message.slice(0, 200) };
  }
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
    const w = window as unknown as { ___grecaptcha_cfg?: { clients?: Record<string, unknown> } };
    void w;
  }, token);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

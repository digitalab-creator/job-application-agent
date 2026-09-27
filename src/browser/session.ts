import fs from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { env } from "../config/env.js";
import { log } from "../logging/logger.js";

const STEALTH_INIT = `(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
})();`;

export async function withApplySession<T>(work: (context: BrowserContext) => Promise<T>): Promise<T> {
  if (env.browserPersistentProfile) {
    return withPersistentContext(work);
  }
  const browser = await chromium.launch({
    headless: env.browserApplyHeadless,
    slowMo: env.browserSlowMoMs,
    args: launchArgs(),
  });
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: env.browserTimezone,
    viewport: { width: 1366, height: 900 },
  });
  await context.addInitScript(STEALTH_INIT);
  try {
    return await work(context);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function withPersistentContext<T>(work: (context: BrowserContext) => Promise<T>): Promise<T> {
  fs.mkdirSync(env.browserUserDataDir, { recursive: true });
  log("BROWSER_SESSION", {
    mode: "persistent",
    headless: env.browserApplyHeadless,
    profile: env.browserUserDataDir,
  });
  const context = await chromium.launchPersistentContext(env.browserUserDataDir, {
    headless: env.browserApplyHeadless,
    slowMo: env.browserSlowMoMs,
    locale: "en-US",
    timezoneId: env.browserTimezone,
    viewport: { width: 1366, height: 900 },
    args: launchArgs(),
    ignoreDefaultArgs: ["--enable-automation"],
  });
  await context.addInitScript(STEALTH_INIT);
  try {
    return await work(context);
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function withHeadlessBrowser<T>(work: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true, args: launchArgs() });
  try {
    return await work(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function launchArgs(): string[] {
  return [
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
  ];
}

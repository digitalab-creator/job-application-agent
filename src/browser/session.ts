import fs from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { env } from "../config/env.js";
import { log } from "../logging/logger.js";
import { resolveBrowserUserDataDir } from "../orchestration/workspace-runtime.js";
import { busterLaunchArgs, resolveBusterExtensionPath } from "./buster-extension.js";

const STEALTH_INIT = `(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
})();`;

export async function withApplySession<T>(work: (context: BrowserContext) => Promise<T>): Promise<T> {
  // Chrome extensions (Buster) only load in a persistent Chromium profile.
  if (env.browserPersistentProfile || resolveBusterExtensionPath()) {
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
  const profileDir = resolveBrowserUserDataDir(env.browserUserDataDir);
  fs.mkdirSync(profileDir, { recursive: true });
  const extensionArgs = busterLaunchArgs();
  const extensionPath = resolveBusterExtensionPath();
  log("BROWSER_SESSION", {
    mode: "persistent",
    headless: env.browserApplyHeadless,
    profile: profileDir,
    buster: Boolean(extensionPath),
    busterPath: extensionPath ?? undefined,
  });
  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless: env.browserApplyHeadless,
    slowMo: env.browserSlowMoMs,
    locale: "en-US",
    timezoneId: env.browserTimezone,
    viewport: { width: 1366, height: 900 },
    args: launchArgs(extensionArgs),
    ignoreDefaultArgs: ["--enable-automation"],
  };
  // Prefer Chromium channel when loading extensions; fall back if this image has no channel binary.
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(
      profileDir,
      extensionArgs.length > 0 ? { ...launchOptions, channel: "chromium" } : launchOptions,
    );
  } catch (error) {
    if (extensionArgs.length === 0) {
      throw error;
    }
    log("BROWSER_CHANNEL_FALLBACK", {
      message: error instanceof Error ? error.message.slice(0, 200) : "channel_failed",
    });
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  }
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

function launchArgs(extra: string[] = []): string[] {
  return [
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    ...extra,
  ];
}

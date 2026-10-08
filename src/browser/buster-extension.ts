import fs from "node:fs";
import path from "node:path";

/** Default unpack location from scripts/fetch-buster.mjs (Buster GPL-3.0). */
export const DEFAULT_BUSTER_EXTENSION_PATH = "/app/vendor/buster";

export function busterEnabled(): boolean {
  const raw = (process.env.CAPTCHA_BUSTER_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

export function resolveBusterExtensionPath(): string | null {
  if (!busterEnabled()) {
    return null;
  }
  const configured = process.env.BUSTER_EXTENSION_PATH?.trim();
  // Explicit path wins: if the operator set it, do not silently fall back elsewhere.
  const candidates = configured
    ? [configured]
    : [DEFAULT_BUSTER_EXTENSION_PATH, path.resolve(process.cwd(), "vendor/buster")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "manifest.json"))) {
      return path.resolve(candidate);
    }
  }
  return null;
}

/** Chromium args that side-load Buster. Empty when the extension is missing or disabled. */
export function busterLaunchArgs(): string[] {
  const extensionPath = resolveBusterExtensionPath();
  if (!extensionPath) {
    return [];
  }
  return [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ];
}

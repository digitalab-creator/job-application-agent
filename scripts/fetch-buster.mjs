#!/usr/bin/env node
/**
 * Download [Buster](https://github.com/dessant/buster) Chrome build into vendor/buster.
 * GPL-3.0 — kept out of git; Docker and local setups call this script.
 */
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const VERSION = process.env.BUSTER_VERSION?.trim() || "3.4.0";
const ZIP_URL =
  process.env.BUSTER_ZIP_URL?.trim()
  || `https://github.com/dessant/buster/releases/download/v${VERSION}/buster_captcha_solver_for_humans-${VERSION}-chrome.zip`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.resolve(root, "vendor/buster");
const zipPath = path.join(root, "tmp", `buster-${VERSION}-chrome.zip`);

async function main() {
  const manifestPath = path.join(dest, "manifest.json");
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (String(manifest.version) === VERSION) {
      console.log(`Buster ${VERSION} already present at ${dest}`);
      return;
    }
  } catch {
    // missing — download
  }

  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  console.log(`Downloading Buster ${VERSION}…`);
  const response = await fetch(ZIP_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Buster download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));

  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  try {
    execFileSync("unzip", ["-q", zipPath, "-d", dest], { stdio: "inherit" });
  } catch {
    execFileSync("python3", ["-c", `
import zipfile
zipfile.ZipFile(${JSON.stringify(zipPath)}).extractall(${JSON.stringify(dest)})
`], { stdio: "inherit" });
  }

  const check = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (String(check.version) !== VERSION) {
    throw new Error(`Expected Buster ${VERSION}, got ${check.version}`);
  }
  console.log(`Buster ${VERSION} ready at ${dest}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

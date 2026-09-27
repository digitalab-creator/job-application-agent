import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

export async function saveScreenshot(page: Page, directory: string, name: string): Promise<string> {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, name);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export function removeOldScreenshots(root: string, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(root)) {
    return;
  }
  for (const day of fs.readdirSync(root)) {
    const dayPath = path.join(root, day);
    const stat = fs.statSync(dayPath);
    if (stat.isDirectory() && stat.mtimeMs < cutoff) {
      fs.rmSync(dayPath, { recursive: true, force: true });
    }
  }
}

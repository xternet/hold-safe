import { expect } from "bun:test";
import { isAbsolute, join } from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { Browser, Video } from "@playwright/test";

export async function demoPage(browser: Browser) {
  const dir = process.env.SOLSTOCK_DEMO_DIR;
  if (dir !== undefined && !isAbsolute(dir)) throw new Error("Demo capture directory must be absolute");
  if (dir !== undefined) await mkdir(dir, { recursive: true });
  const size = { width: 1280, height: 900 };
  const page = await browser.newPage({ viewport: size, ...(dir === undefined ? {} : { recordVideo: { dir, size } }) });
  if (dir !== undefined) await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const label = document.createElement("div");
      label.textContent = "LOCAL SVM DEMO · controlled market inputs · no mainnet funds · test wallet";
      label.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#161c26;color:white;padding:12px;text-align:center;font:16px sans-serif;pointer-events:none";
      document.body.appendChild(label);
    });
  });
  return page;
}
export async function finishClip(video: Video | null, name: string): Promise<void> {
  const dir = process.env.SOLSTOCK_DEMO_DIR;
  if (dir === undefined) return;
  if (video === null) throw new Error("Requested demo video missing");
  const path = join(dir, `${name}.webm`);
  await video.saveAs(path);
  expect((await stat(path)).size).toBeGreaterThan(1024);
  await video.delete();
}

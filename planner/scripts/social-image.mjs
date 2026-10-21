import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const source = await readFile(new URL("../public/social-card.svg", import.meta.url), "utf8");
const browser = await chromium.launch({
  headless: true, channel: process.platform === "win32" ? "msedge" : undefined,
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:1200px;height:630px;overflow:hidden}svg{display:block}</style></head><body>${source}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL("../public/social-card.png", import.meta.url)) });
  console.log("Generated the public 1200 x 630 brand image without private data or external requests.");
} finally {
  await browser.close();
}

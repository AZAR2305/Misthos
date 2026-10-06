// Assemble a 2x2 contact sheet of per-theme screenshots: node scripts/sheet.mjs <dir> <page> [<page> ...]
// Reads <dir>/theme-<theme>-<page>.png and writes <dir>/sheet-<page>.png
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [dirArg, ...pages] = process.argv.slice(2);
const dir = path.resolve(dirArg);
const THEMES = ["mint", "mint-dark"];
const browser = await chromium.launch({ channel: "msedge" });
for (const p of pages) {
  const cells = THEMES.map(
    (t) => `<figure style="margin:0;position:relative"><img style="width:100%;display:block" src="${pathToFileURL(path.join(dir, `theme-${t}-${p}.png`))}"><figcaption style="position:absolute;left:8px;top:8px;background:#000c;color:#fff;font:600 13px system-ui;padding:3px 8px;border-radius:5px">${t}</figcaption></figure>`,
  ).join("");
  const f = path.join(dir, `sheet-${p}.html`);
  fs.writeFileSync(f, `<body style="margin:0;background:#777;display:grid;grid-template-columns:1fr 1fr;gap:6px;width:1600px">${cells}</body>`);
  const page = await browser.newPage({ viewport: { width: 1600, height: 910 } });
  await page.goto(pathToFileURL(f).href);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, `sheet-${p}.png`), fullPage: true });
  await page.close();
}
await browser.close();

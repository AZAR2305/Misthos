// Renders the same screens in every colour theme and assembles 2x2 contact sheets for side-by-side comparison.
//   node scripts/themes.mjs [baseUrl]      (needs a running build; writes ./shots/themes)
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const base = process.argv[2] ?? "http://localhost:3000";
const out = path.resolve("shots", "themes");
fs.mkdirSync(out, { recursive: true });
const THEMES = ["emerald", "violet-night", "violet-light", "midnight-coral"];
const SCREENS = [
  { id: "hero", url: "/", scroll: () => 0, wait: 4500 },
  { id: "ring", url: "/", scroll: () => document.getElementById("steps").offsetTop + 320, wait: 4500 },
  { id: "agents", url: "/", scroll: () => document.getElementById("agents").offsetTop + 40, wait: 5200 },
  { id: "app", url: "/app", scroll: () => 0, wait: 1500 },
  { id: "kit", url: "/kit", scroll: () => 0, wait: 1200 },
];

const browser = await chromium.launch({ channel: "msedge", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const t of THEMES) {
  for (const s of SCREENS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${base}${s.url}?theme=${t}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(s.wait);
    await page.evaluate(`window.scrollTo(0, (${s.scroll.toString()})())`);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(out, `${t}-${s.id}.png`) });
    await page.close();
  }
  console.log("captured", t);
}

// contact sheets: one per screen, the four themes in a 2x2 grid
for (const s of SCREENS) {
  const html = `<body style="margin:0;background:#888;display:grid;grid-template-columns:1fr 1fr;gap:6px;width:1600px">${THEMES.map(
    (t) => `<figure style="margin:0;position:relative"><img style="width:100%;display:block" src="${pathToFileURL(path.join(out, `${t}-${s.id}.png`))}"><figcaption style="position:absolute;left:8px;top:8px;background:#000c;color:#fff;font:600 13px system-ui;padding:3px 8px;border-radius:5px">${t}</figcaption></figure>`,
  ).join("")}</body>`;
  const f = path.join(out, `sheet-${s.id}.html`);
  fs.writeFileSync(f, html);
  const page = await browser.newPage({ viewport: { width: 1600, height: 910 } });
  await page.goto(pathToFileURL(f).href);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `sheet-${s.id}.png`) });
  await page.close();
}
await browser.close();
console.log("sheets in", out);

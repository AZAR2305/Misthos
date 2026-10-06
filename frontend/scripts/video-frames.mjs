// Pull evenly spaced frames out of a screen recording, no ffmpeg needed:
//   node scripts/video-frames.mjs <video.mp4> <outDir> [count=12]
// Loads the video in headless Edge, seeks, and screenshots the <video> element.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [videoArg, outArg, countArg] = process.argv.slice(2);
const video = path.resolve(videoArg);
const out = path.resolve(outArg);
const count = Number(countArg ?? 12);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const html = path.join(out, "player.html");
fs.writeFileSync(html, `<body style="margin:0;background:#000"><video id="v" src="${pathToFileURL(video)}" muted style="width:1280px;height:720px;object-fit:contain"></video></body>`);
await page.goto(pathToFileURL(html).href);
await page.waitForFunction(() => document.getElementById("v").readyState >= 1);
const dur = await page.evaluate(() => document.getElementById("v").duration);
console.log("duration", dur.toFixed(1), "s");
for (let i = 0; i < count; i++) {
  const t = Math.min(dur - 0.05, (dur * (i + 0.5)) / count);
  await page.evaluate((t) => new Promise((res) => {
    const v = document.getElementById("v");
    v.onseeked = () => res(null);
    v.currentTime = t;
  }), t);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `f${String(i).padStart(2, "0")}-${t.toFixed(1)}s.png`) });
}
await browser.close();

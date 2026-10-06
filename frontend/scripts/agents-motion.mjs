// Drives the agents stage through the Accept and Post offer choreography and captures frames, to check they walk, jump and dance.
//   node scripts/agents-motion.mjs [baseUrl] [theme]
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const theme = process.argv[3] ?? "violet-night";
const out = path.resolve("shots", "motion");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/:410[12]/.test(m.location().url ?? "") && errors.push(m.text()));
await page.goto(`${base}/?theme=${theme}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, document.getElementById("agents").offsetTop + 60));
await page.waitForTimeout(4500);
const stage = page.locator(".stage-canvas");
const snap = async (name) => stage.screenshot({ path: path.join(out, `${theme}-${name}.png`) });

await snap("0-rest");
await page.getByRole("button", { name: "Post offer" }).click();
for (const [ms, n] of [[700, "offer-walking"], [1400, "offer-handover"], [1700, "offer-returning"]]) {
  await page.waitForTimeout(ms);
  await snap(n);
}
await page.waitForTimeout(3500);
await page.getByRole("button", { name: "Accept" }).click();
for (const [ms, n] of [[800, "accept-walking"], [1600, "accept-thumbsup"], [1500, "accept-dance"], [1200, "accept-dance2"]]) {
  await page.waitForTimeout(ms);
  await snap(n);
}
console.log("console errors:", errors.length ? errors.slice(0, 3) : "none");
await browser.close();

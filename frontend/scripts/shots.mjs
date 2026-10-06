// Screenshot the landing page at the spec's breakpoints (CLAUDE.md 0.3: 375 / 768 / 1280) and at key scroll positions.
// Usage: node scripts/shots.mjs [baseUrl] [only]   (needs the dev server; uses the installed Edge/Chrome)
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const only = process.argv[3];
const out = path.resolve("shots");
fs.mkdirSync(out, { recursive: true });

const sizes = [
  { name: "1280", width: 1280, height: 720 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
];

const browser = await chromium.launch({
  channel: "msedge",
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});

for (const s of sizes) {
  if (only && only !== s.name) continue;
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(4500); // intro animation

  const marks = await page.evaluate(() => {
    const vh = window.innerHeight;
    const top = (id) => document.getElementById(id).offsetTop;
    const h = (id) => document.getElementById(id).offsetHeight;
    const steps = top("steps");
    const len = h("steps") - vh;
    return {
      hero: 0,
      scatter: vh * 1.0,
      feature2: top("features") + vh * 1.0,
      steps0: steps + vh * 0.05,
      steps2: steps + len * 0.5,
      steps4: steps + len * 0.98,
      agents: top("agents"),
      why: top("why"),
      final: top("final") + vh * 0.0,
      finalEnd: document.documentElement.scrollHeight - vh,
    };
  });

  for (const [k, y] of Object.entries(marks)) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(out, `${s.name}-${k}.png`) });
  }
  console.log(s.name, "console errors:", errors.length ? errors.slice(0, 6) : "none");
  await page.close();
}
await browser.close();
console.log("saved to", out);

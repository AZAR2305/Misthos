// Rough frame-rate probe at three scroll positions. Software GL in the test browser, so only compare runs with each other.
// Usage: node scripts/fps.mjs [baseUrl]
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch({
  channel: "msedge",
  args: process.env.SOFTWARE ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(4500);
const probe = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          performance.now() - t0 > 3000 ? res(+(n / 3).toFixed(2)) : requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
  );
const at = async (name, fn) => {
  await page.evaluate(fn);
  await page.waitForTimeout(1200);
  console.log(name.padEnd(8), await probe(), "fps");
};
await at("hero", () => window.scrollTo(0, 0));
await at("ring", () => window.scrollTo(0, document.getElementById("steps").offsetTop + 300));
await at("agents", () => window.scrollTo(0, document.getElementById("agents").offsetTop + 60));
await browser.close();

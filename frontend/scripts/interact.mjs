// Drives the agent stage and the menu, and saves screenshots of each state.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const out = path.resolve("shots");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

// menu
await page.click(".nav-burger");
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(out, "i-menu.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// agents
await page.evaluate(() => window.scrollTo(0, document.getElementById("agents").offsetTop + 60));
await page.waitForTimeout(3500);
const shot = (n) => page.screenshot({ path: path.join(out, `i-${n}.png`) });
await page.getByRole("button", { name: "Post offer" }).click();
await page.waitForTimeout(500);
await shot("offer");
await page.getByRole("button", { name: "Reject" }).click();
await page.waitForTimeout(1400);
await shot("reject");
await page.getByRole("button", { name: "Accept" }).click();
await page.waitForTimeout(1600);
await shot("accept");
console.log("console errors:", errors.length ? errors : "none");
await browser.close();

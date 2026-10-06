// End-to-end test of accounts: Google sign-in, linking one wallet, choosing a side, and the guards around them.
//   pnpm --filter @misthos/frontend e2e:accounts
// Real: an Anvil chain, the real contract, the real backend process (HTTP, Postgres via PGlite, the production Google
// verification code), the real built app and UI. Stand-ins, and only these: (1) Google's own button, which cannot run
// headless, is replaced in the page by a button that returns an ID token; the token is genuinely signed (RS256) by a key
// this script owns, and the backend is configured to trust that key through its normal GOOGLE_JWKS_URL setting.
// (2) The browser wallet is an EIP-1193 object that signs with Anvil's unlocked test accounts. Screenshots: ./shots/e2e-accounts.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync, createSign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { keccak256, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const MNEMONIC = "test test test test test test test test test test test junk";
const ANVIL = 8546, APP = 3101, API = 4020, JWKS = 4021;
const RPC = `http://127.0.0.1:${ANVIL}`;
const BASE = `http://127.0.0.1:${APP}`;
const API_URL = `http://127.0.0.1:${API}`;
const CLIENT_ID = "e2e-client.apps.googleusercontent.com";
const root = path.resolve(import.meta.dirname, "..", "..");
const shots = path.resolve(import.meta.dirname, "..", "shots", "e2e-accounts");
fs.mkdirSync(shots, { recursive: true });
const acct = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const [supplier, buyer] = [acct(1).address.toLowerCase(), acct(2).address.toLowerCase()];

const procs = [];
const servers = [];
const log = (m) => console.log(`\n== ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { throw new Error(`E2E FAILED: ${m}`); };
const check = (cond, m) => { if (!cond) fail(m); console.log(`  ok  ${m}`); };
async function waitFor(fn, what, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch { /* retry */ } await sleep(300); }
  fail(`timed out waiting for ${what}`);
}
const rpc = async (method, params = []) => (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

// ---- a Google stand-in: our own key, published at a JWKS URL the backend is configured to trust
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e", alg: "RS256", use: "sig" };
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function idToken(sub, email, name, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", typ: "JWT", kid: "e2e" });
  const body = b64({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub, email, email_verified: true, name, nonce, iat: now, exp: now + 3600 });
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

// ---- in the page: Google's button (stand-in) and the browser wallet (stand-in)
const PAGE_SCRIPT = `(() => {
  window.google = { accounts: { id: {
    initialize(cfg) { window.__gcfg = cfg; },
    renderButton(el) { const b = document.createElement("button"); b.id = "google-standin"; b.type = "button"; b.textContent = "Continue with Google (stand-in)"; b.onclick = async () => { const credential = await window.__mint(window.__gcfg.nonce); window.__gcfg.callback({ credential }); }; el.appendChild(b); },
  } } };
  let current = sessionStorage.getItem("__acct");
  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  const rpc = async (method, params) => {
    const r = await fetch("${RPC}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
    return j.result;
  };
  const provider = {
    request: async ({ method, params = [] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return current ? [current] : [];
      if (method === "eth_chainId") return "0x7a69";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      return rpc(method, params);
    },
    on(e, f) { (listeners[e] ||= []).push(f); },
    removeListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
  };
  window.__connectAs = (a) => { current = a; sessionStorage.setItem("__acct", a); };
  window.__switchTo = (a) => { current = a; sessionStorage.setItem("__acct", a); emit("accountsChanged", [a]); };
  window.addEventListener("eip6963:requestProvider", () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "e2e", name: "Test wallet", icon: "", rdns: "test.e2e" }, provider }) })));
})();`;

async function main() {
  log("1. a real chain, the real contract, and a Google stand-in key server");
  procs.push(spawn("anvil", ["--silent", "--port", String(ANVIL), "--chain-id", "31337"], { stdio: "ignore" }));
  await waitFor(async () => (await rpc("eth_chainId")) === "0x7a69", "anvil");
  execFileSync("forge", ["script", "script/DeployLocal.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: path.join(root, "contract"), stdio: "pipe" });
  const dep = JSON.parse(fs.readFileSync(path.join(root, "contract", "deployments", "31337.json"), "utf8"));
  check(/^0x[0-9a-fA-F]{40}$/.test(dep.invoiceBook), `InvoiceBook at ${dep.invoiceBook}`);
  servers.push(createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); }).listen(JWKS, "127.0.0.1"));

  log("2. start the real backend");
  const tsx = path.join(root, "backend", "node_modules", "tsx", "dist", "cli.mjs");
  const be = spawn(process.execPath, [tsx, "src/server.ts"], {
    cwd: path.join(root, "backend"),
    env: { ...process.env, DATABASE_URL: "pglite://memory", PORT: String(API), ARC_RPC_URL: RPC, ARC_CHAIN_ID: "31337", INVOICE_BOOK_ADDRESS: dep.invoiceBook, USDC_ADDRESS: dep.usdc, DEPLOY_BLOCK: String(dep.deployBlock),
      GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_JWKS_URL: `http://127.0.0.1:${JWKS}/certs`, FRONTEND_ORIGINS: BASE, RELAYER_PRIVATE_KEY: "0x" + Buffer.from(acct(3).getHdKey().privateKey).toString("hex") },
    stdio: "ignore",
  });
  procs.push(be);
  await waitFor(async () => (await fetch(`${API_URL}/api/health`)).ok, "backend");
  const health = (await (await fetch(`${API_URL}/api/health`)).json()).data;
  check(health.db.ok && health.rpc.ok && health.google.configured && health.relayer.configured, "backend healthy: db, rpc, Google verifier and relayer are on");

  log("3. build the app against the backend");
  const env = { ...process.env, NEXT_DIST_DIR: ".next-e2e-acct", NEXT_PUBLIC_CHAIN_ID: "31337", NEXT_PUBLIC_RPC_URL: RPC, NEXT_PUBLIC_INVOICE_BOOK_ADDRESS: dep.invoiceBook, NEXT_PUBLIC_USDC_ADDRESS: dep.usdc, NEXT_PUBLIC_DEPLOY_BLOCK: String(dep.deployBlock), NEXT_PUBLIC_EXPLORER_URL: "http://localhost:1", NEXT_PUBLIC_API_URL: API_URL, NEXT_PUBLIC_GOOGLE_CLIENT_ID: CLIENT_ID };
  const cwd = path.resolve(import.meta.dirname, "..");
  const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
  execFileSync(process.execPath, [nextBin, "build"], { cwd, env, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  procs.push(spawn(process.execPath, [nextBin, "start", "-p", String(APP), "-H", "127.0.0.1"], { cwd, env, stdio: "ignore" }));
  await waitFor(async () => (await fetch(BASE)).ok, "next start");

  const browser = await chromium.launch({ channel: "msedge", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const newCtx = async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c.addInitScript(PAGE_SCRIPT); return c; };
  const errors = [];
  const watch = (page) => {
    page.on("console", (m) => { if (m.type() !== "error") return; const t = m.text(); const u = m.location().url ?? ""; if (/:410[12]/.test(u + t)) return; // the agents are not running in this test
      if (/status of 409/.test(t)) return; // step 8 deliberately provokes the server's 409 (wallet already linked)
      errors.push(t); });
    page.on("pageerror", (e) => errors.push(String(e)));
  };
  const ctx = await newCtx();
  const page = await ctx.newPage();
  watch(page);
  const me1 = { sub: "g-supplier", email: "supplier@example.com", name: "Supplier Co" };
  await page.exposeFunction("__mint", (nonce) => idToken(me1.sub, me1.email, me1.name, nonce));
  const shot = (n) => page.screenshot({ path: path.join(shots, `${n}.png`) });
  const text = (t) => page.getByText(t, { exact: false }).first();

  log("4. signed out: public pages open, side pages ask you to sign in");
  await page.goto(`${BASE}/app`);
  await text("Sign in to get started").waitFor();
  await text("Step 1 of 3").waitFor();
  await sleep(700);
  check(true, "/app starts at step 1: sign in with Google");
  await shot("01-sign-in");
  await page.goto(`${BASE}/stats`);
  await page.locator("h1").first().waitFor();
  check(!(await page.getByText("Sign in to get started").count()), "/stats (public) needs no sign-in");
  await page.goto(`${BASE}/supplier`);
  await text("Sign in to get started").waitFor();
  check(true, "/supplier shows the sign-in steps instead of the dashboard");

  log("5. Google, then link the wallet by signing a message");
  await page.goto(`${BASE}/app`);
  await page.locator("#google-standin").click();
  await page.getByRole("heading", { name: "Link your wallet" }).waitFor();
  await sleep(700); // let the entrance animation finish before the screenshot
  await shot("02-link-wallet");
  const hits = await page.getByText("supplier@example.com").evaluateAll((els) => els.map((e) => e.tagName + ":" + getComputedStyle(e).display + ":" + (e.textContent || "").slice(0, 40)));
  check(hits.length > 0, `signed in as supplier@example.com, now at step 2 (${hits.join(" | ")})`);
  await page.evaluate((a) => window.__connectAs(a), supplier);
  await page.locator(".wallet-card", { hasText: "Test wallet" }).click();
  await page.getByRole("button", { name: "Link this wallet" }).click();
  await text("How will you use Misthos?").waitFor();
  check(true, "the wallet signed the challenge and was linked: step 3");
  const meAfterLink = await page.evaluate(async (u) => (await (await fetch(`${u}/api/me`, { credentials: "include" })).json()).data, API_URL);
  check(meAfterLink.address === supplier && meAfterLink.side === null && meAfterLink.step === "side", "the server holds exactly that wallet, no side yet");
  await shot("03-choose-side");

  log("6. choose a side; it persists across a reload");
  await page.locator(".role-card[data-role=supplier]").click();
  await page.waitForURL(/\/supplier$/);
  check(await page.locator(".role-switch button[data-role=supplier][aria-pressed=true]").count() === 1, "on the supplier dashboard, supplier side active");
  await page.reload();
  await page.locator("h1").first().waitFor();
  await page.goto(`${BASE}/app`);
  await text("You are set up as a supplier").waitFor();
  check(true, "after a reload the session and the side come back from the server");
  await shot("04-overview");

  log("6b. the supplier creates an invoice; the Misthos server registers it and pays the fee");
  const relayerAddr = acct(3).address.toLowerCase();
  await page.goto(`${BASE}/supplier/invoices/new`, { waitUntil: "networkidle" });
  await page.fill("#buyer", buyer);
  await page.fill("#amount", "2500");
  await page.fill("#due", new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await page.fill("#ref", "PO-RELAY-1");
  await page.locator(".preview").waitFor();
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/invoices\/0x[0-9a-f]{64}/, { timeout: 90_000 });
  const relayedId = page.url().split("/").pop();
  const logs = await rpc("eth_getLogs", [{ address: dep.invoiceBook, fromBlock: "0x0", toBlock: "latest", topics: [keccak256(toHex("InvoiceRegistered(bytes32,address,address,address,uint256,uint64,bytes32)")), relayedId] }]);
  check(logs.length === 1, "the invoice is registered on the chain");
  const regTx = await rpc("eth_getTransactionByHash", [logs[0].transactionHash]);
  check(regTx.from.toLowerCase() === relayerAddr, "the registration was sent by the relayer: the supplier's wallet paid no network fee");
  check(regTx.from.toLowerCase() !== supplier, "...and not by the supplier's own wallet");
  await shot("04b-relayed-invoice");

  log("6c. signing with a wallet that is not the linked one is refused");
  await page.evaluate((a) => window.__switchTo(a), buyer);
  await page.goto(`${BASE}/supplier/invoices/new`, { waitUntil: "networkidle" });
  await text("This is not the wallet linked to your account").waitFor();
  await page.fill("#buyer", supplier);
  await page.fill("#amount", "10");
  await page.fill("#ref", "PO-WRONG");
  await page.locator("button[type=submit]").click().catch(() => {});
  await sleep(1200);
  check((await page.getByText("Wrong wallet").count()) > 0 || (await page.getByText("is not the one linked").count()) > 0, "a different wallet cannot sign: the app explains why");
  await page.evaluate((a) => window.__switchTo(a), supplier);

  log("7. the guards");
  await page.goto(`${BASE}/buyer`);
  await text("This page is for buyers").waitFor();
  check(true, "a supplier account opening /buyer sees a switch prompt, not the buyer page");
  await page.evaluate((a) => window.__switchTo(a), buyer);
  await text("This is not the wallet linked to your account").waitFor();
  check(true, "switching the wallet to a different address shows a warning banner");
  await shot("05-wallet-mismatch");
  await page.evaluate((a) => window.__switchTo(a), supplier);
  await page.getByRole("button", { name: "Switch to buyer" }).click();
  await page.waitForURL(/\/buyer$/);
  const me2 = await page.evaluate(async (u) => (await (await fetch(`${u}/api/me`, { credentials: "include" })).json()).data, API_URL);
  check(me2.side === "buyer", "switching sides is saved on the server");

  log("8. one wallet belongs to one account");
  const ctx2 = await newCtx();
  const p2 = await ctx2.newPage();
  watch(p2);
  await p2.exposeFunction("__mint", (nonce) => idToken("g-other", "other@example.com", "Other", nonce));
  await p2.goto(`${BASE}/app`);
  await p2.locator("#google-standin").click();
  await p2.getByRole("heading", { name: "Link your wallet" }).waitFor();
  await p2.evaluate((a) => window.__connectAs(a), supplier);
  await p2.locator(".wallet-card", { hasText: "Test wallet" }).click();
  await p2.getByRole("button", { name: "Link this wallet" }).click();
  await p2.getByText("already linked to another account").first().waitFor();
  check(true, "a second Google account cannot take the same wallet");
  await p2.screenshot({ path: path.join(shots, "06-wallet-taken.png") });
  await ctx2.close();

  log("9. sign out");
  await page.goto(`${BASE}/app`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await text("Sign in to get started").waitFor();
  const me3 = await page.evaluate(async (u) => (await (await fetch(`${u}/api/me`, { credentials: "include" })).json()).data, API_URL);
  check(me3 === null, "signed out on the server too");

  check(errors.length === 0, `no console errors in the app${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await browser.close();
  console.log("\nE2E ACCOUNTS PASSED");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => { for (const p of procs) p.kill(); for (const s of servers) s.close(); setTimeout(() => process.exit(process.exitCode ?? 0), 500); });

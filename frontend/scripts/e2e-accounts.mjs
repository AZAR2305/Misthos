// End-to-end test of accounts: signing in with a wallet signature, choosing a side, and the guards around them.
//   pnpm --filter @misthos/frontend e2e:accounts
// Real: an Anvil chain, the real contract, the real backend process (HTTP, Postgres via PGlite, the production sign-in code),
// the real built app and UI. The one stand-in: the browser wallet is an EIP-1193 object that signs with Anvil's unlocked test
// accounts. Screenshots: ./shots/e2e-accounts.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { keccak256, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const MNEMONIC = "test test test test test test test test test test test junk";
const ANVIL = 8546, APP = 3101, API = 4020;
const RPC = `http://127.0.0.1:${ANVIL}`;
const BASE = `http://127.0.0.1:${APP}`;
const API_URL = `http://127.0.0.1:${API}`;
const root = path.resolve(import.meta.dirname, "..", "..");
const shots = path.resolve(import.meta.dirname, "..", "shots", "e2e-accounts");
fs.mkdirSync(shots, { recursive: true });
const acct = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const [supplier, buyer] = [acct(1).address.toLowerCase(), acct(2).address.toLowerCase()];

// `next build` rewrites tsconfig.json to include each build folder. Put it back when this run ends, so a test run never changes a tracked file.
const TSCONFIG = path.resolve(import.meta.dirname, "..", "tsconfig.json");
const TSCONFIG_ORIGINAL = fs.readFileSync(TSCONFIG, "utf8");
const restoreTsconfig = () => fs.writeFileSync(TSCONFIG, TSCONFIG_ORIGINAL);
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

// ---- in the page: the browser wallet (stand-in)
const PAGE_SCRIPT = `(() => {
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
  log("1. a real chain and the real contract");
  procs.push(spawn("anvil", ["--silent", "--port", String(ANVIL), "--chain-id", "31337"], { stdio: "ignore" }));
  await waitFor(async () => (await rpc("eth_chainId")) === "0x7a69", "anvil");
  execFileSync("forge", ["script", "script/DeployLocal.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: path.join(root, "contract"), stdio: "pipe" });
  const dep = JSON.parse(fs.readFileSync(path.join(root, "contract", "deployments", "31337.json"), "utf8"));
  check(/^0x[0-9a-fA-F]{40}$/.test(dep.invoiceBook), `InvoiceBook at ${dep.invoiceBook}`);

  log("2. start the real backend");
  const tsx = path.join(root, "backend", "node_modules", "tsx", "dist", "cli.mjs");
  const be = spawn(process.execPath, [tsx, "src/server.ts"], {
    cwd: path.join(root, "backend"),
    env: { ...process.env, DATABASE_URL: "pglite://memory", PORT: String(API), ARC_RPC_URL: RPC, ARC_CHAIN_ID: "31337", INVOICE_BOOK_ADDRESS: dep.invoiceBook, USDC_ADDRESS: dep.usdc, DEPLOY_BLOCK: String(dep.deployBlock),
      FRONTEND_ORIGINS: BASE, AGENT_WALLETS: acct(5).address, RELAYER_PRIVATE_KEY: "0x" + Buffer.from(acct(3).getHdKey().privateKey).toString("hex") },
    stdio: "ignore",
  });
  procs.push(be);
  await waitFor(async () => (await fetch(`${API_URL}/api/health`)).ok, "backend");
  const health = (await (await fetch(`${API_URL}/api/health`)).json()).data;
  check(health.db.ok && health.rpc.ok && health.relayer.configured, "backend healthy: db, rpc and relayer are on");

  log("3. build the app against the backend");
  const env = { ...process.env, NEXT_DIST_DIR: ".next-e2e-acct", NEXT_PUBLIC_CHAIN_ID: "31337", NEXT_PUBLIC_RPC_URL: RPC, NEXT_PUBLIC_INVOICE_BOOK_ADDRESS: dep.invoiceBook, NEXT_PUBLIC_USDC_ADDRESS: dep.usdc, NEXT_PUBLIC_DEPLOY_BLOCK: String(dep.deployBlock), NEXT_PUBLIC_EXPLORER_URL: "http://localhost:1", NEXT_PUBLIC_API_URL: API_URL };
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
      if (/status of 409/.test(t)) return; // an earlier step may provoke a 409
      errors.push(t); });
    page.on("pageerror", (e) => errors.push(String(e)));
  };
  const ctx = await newCtx();
  const page = await ctx.newPage();
  watch(page);
  const shot = (n) => page.screenshot({ path: path.join(shots, `${n}.png`) });
  const text = (t) => page.getByText(t, { exact: false }).first();

  log("4. signed out: public pages open, side pages ask you to sign in");
  await page.goto(`${BASE}/app`);
  await text("Sign in with your wallet").waitFor();
  await text("Step 1 of 2").waitFor();
  await sleep(700);
  check(true, "/app starts at step 1: sign in with your wallet");
  await shot("01-sign-in");
  await page.goto(`${BASE}/stats`);
  await page.locator("h1").first().waitFor();
  check(!(await page.getByText("Sign in with your wallet").count()), "/stats (public) needs no sign-in");
  await page.goto(`${BASE}/supplier`);
  await text("Sign in with your wallet").waitFor();
  check(true, "/supplier shows the sign-in steps instead of the dashboard");

  log("5. sign in by signing a message with the wallet (no email, no third party)");
  await page.goto(`${BASE}/app`);
  await sleep(700); // let the entrance animation finish before the screenshot
  await shot("02-sign-in-wallet");
  await page.evaluate((a) => window.__connectAs(a), supplier);
  await page.locator(".wallet-card", { hasText: "Test wallet" }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await text("How will you use Misthos?").waitFor();
  check(true, "the wallet signed the message and the account was created: step 2");
  const meAfterLink = await page.evaluate(async (u) => (await (await fetch(`${u}/api/me`, { credentials: "include" })).json()).data, API_URL);
  check(meAfterLink.address === supplier && meAfterLink.side === null && meAfterLink.step === "side", "the server holds exactly that wallet, no side yet");
  check(!("email" in meAfterLink), "the account holds no email");
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
  check((await page.getByText("Wrong wallet").count()) > 0 || (await page.getByText("is not the one you signed in with").count()) > 0, "a different wallet cannot sign: the app explains why");
  await page.evaluate((a) => window.__switchTo(a), supplier);

  log("6d. credit limits: set them, see them versioned, link an agent, and read the credit basis on an invoice");
  await page.goto(`${BASE}/supplier/policy`, { waitUntil: "networkidle" });
  await text("No limits set yet").waitFor();
  check(true, "with no limits saved the page says nobody is given credit by default");
  await page.fill("#xp-start", "5000");
  await page.fill("#xp-max", "20000");
  await page.getByRole("button", { name: "Save limits" }).click();
  await text("In force: exposure-1").waitFor();
  const pol1 = await page.evaluate(async (u) => (await (await fetch(`${u}/api/exposure-policy`, { credentials: "include" })).json()).data, API_URL);
  check(pol1.version === "exposure-1" && pol1.newCounterpartyLimit === "5000000000" && pol1.maxLimit === "20000000000" && pol1.growthBps === 2000, "saved on the server as version exposure-1, in integer minor units");
  await page.fill("#xp-start", "6000");
  await page.getByRole("button", { name: "Save limits" }).click();
  await text("In force: exposure-2").waitFor();
  check(true, "changing a number makes a new version (exposure-2)");
  await page.fill("#xp-max", "1");
  await page.getByRole("button", { name: "Save limits" }).click();
  await text("cannot be lower than the starting limit").waitFor();
  check(true, "a maximum below the starting limit is refused with a plain message");
  await page.fill("#xp-max", "20000");
  await shot("04c-credit-limits");

  await text("Not linked yet").waitFor();
  await page.getByRole("button", { name: "Make a link code" }).click();
  await text("MISTHOS_LINK_CODE=").waitFor();
  const linkCode = /MISTHOS_LINK_CODE=([A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4})/.exec(await page.locator("body").innerText())?.[1];
  check(!!linkCode, "the owner got a one-time link code");
  const agentAcct = acct(5);
  const nonceOf = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const readHeaders = async (resource, ts, nonce = nonceOf()) => ({
    "x-agent-wallet": agentAcct.address,
    "x-agent-ts": String(ts),
    "x-agent-nonce": nonce,
    "x-agent-sig": await agentAcct.signTypedData({ domain: { name: "Misthos", version: "1", chainId: 31337, verifyingContract: dep.invoiceBook }, types: { AgentRead: [{ name: "resource", type: "string" }, { name: "ts", type: "uint64" }, { name: "nonce", type: "string" }] }, primaryType: "AgentRead", message: { resource, ts: BigInt(ts), nonce } }),
  });
  const ts0 = Math.floor(Date.now() / 1000);
  const bad = await fetch(`${API_URL}/api/agent/link/${linkCode}`, { method: "POST", headers: await readHeaders("/api/agent/link/SOMEONE-ELSES-CODE", ts0) });
  check(bad.status === 401, "a request signed for a different code is refused");
  const okHeaders = await readHeaders(`/api/agent/link/${linkCode}`, ts0);
  const okRes = await fetch(`${API_URL}/api/agent/link/${linkCode}`, { method: "POST", headers: okHeaders });
  check(okRes.status === 200, "the agent wallet redeemed the code with a signature of its own");
  const replayed = await fetch(`${API_URL}/api/agent/link/${linkCode}`, { method: "POST", headers: okHeaders });
  check(replayed.status === 401, "the same signed request cannot be replayed");
  const again = await fetch(`${API_URL}/api/agent/link/${linkCode}`, { method: "POST", headers: await readHeaders(`/api/agent/link/${linkCode}`, ts0) });
  check(again.status === 400, "the code works once");
  await page.reload({ waitUntil: "networkidle" });
  await text("Your agent is linked").waitFor();
  check(true, "the page now shows the agent as linked");
  await shot("04d-agent-linked");

  await page.goto(`${BASE}/invoices/${relayedId}`, { waitUntil: "networkidle" });
  await text("Credit limit for this business").waitFor();
  await text("Allowed limit").waitFor();
  await text("Fits the limit").waitFor();
  check(true, "the invoice page shows the credit basis: allowed limit, and the 2,500 USDC invoice fits inside 6,000");
  await text("No settled invoices with this business yet").waitFor();
  check(true, "with no history it says the limit is the starting limit, and settlements raise it");
  await shot("04e-credit-basis");

  // credit is enforced where it is extended: an invoice over the supplier's own limit is not registered for them
  await page.goto(`${BASE}/supplier/invoices/new`, { waitUntil: "networkidle" });
  await page.fill("#buyer", buyer);
  await page.fill("#amount", "7000");
  await page.fill("#due", new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await page.fill("#ref", "PO-TOO-BIG");
  await page.locator(".preview").waitFor();
  await page.locator("button[type=submit]").click();
  await text("past the limit you set").waitFor({ timeout: 60_000 });
  check(true, "a 7,000 USDC invoice is refused under a 6,000 limit, with the reason, while the 2,500 one was registered");
  const bigLogs = await rpc("eth_getLogs", [{ address: dep.invoiceBook, fromBlock: "0x0", toBlock: "latest", topics: [keccak256(toHex("InvoiceRegistered(bytes32,address,address,address,uint256,uint64,bytes32)"))] }]);
  check(bigLogs.length === 1, "and nothing more was registered on the chain");

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

  log("8. one wallet is one account: signing in again from another browser returns the same account");
  const ctx2 = await newCtx();
  const p2 = await ctx2.newPage();
  watch(p2);
  await p2.goto(`${BASE}/app`);
  await p2.evaluate((a) => window.__connectAs(a), supplier);
  await p2.locator(".wallet-card", { hasText: "Test wallet" }).click();
  await p2.getByRole("button", { name: "Sign in", exact: true }).click();
  await p2.waitForURL(/\/(supplier|buyer)$|\/app$/, { timeout: 30_000 }).catch(() => {});
  await sleep(800);
  const meAgain = await p2.evaluate(async (u) => (await (await fetch(`${u}/api/me`, { credentials: "include" })).json()).data, API_URL);
  check(meAgain && meAgain.id === meAfterLink.id && meAgain.address === supplier, "the same wallet is the same account, not a duplicate");
  await p2.screenshot({ path: path.join(shots, "06-same-wallet-same-account.png") });
  await ctx2.close();

  log("9. claim link: the buyer invites the supplier; the supplier, with no account, signs; the buyer pays at 0%");
  // The buyer signs in with their own wallet, in their own browser.
  const ctxB = await newCtx();
  const pb = await ctxB.newPage();
  watch(pb);
  await pb.goto(`${BASE}/app`);
  await pb.evaluate((a) => window.__connectAs(a), buyer);
  await pb.locator(".wallet-card", { hasText: "Test wallet" }).click();
  await pb.getByRole("button", { name: "Sign in", exact: true }).click();
  await pb.getByText("How will you use Misthos?").waitFor();
  await pb.locator(".role-card[data-role=buyer]").click();
  await pb.waitForURL(/\/buyer$/);
  // Approve the relayed invoice, then invite the supplier.
  await pb.goto(`${BASE}/invoices/${relayedId}`, { waitUntil: "networkidle" });
  await pb.getByRole("button", { name: "Approve invoice" }).click();
  await pb.getByText("Invite the supplier to be paid early").waitFor({ timeout: 60_000 });
  await pb.fill("#claim-rate", "0");
  check(await pb.getByRole("button", { name: "Create claim link" }).isDisabled(), "a link cannot be made until the buyer says who they expect to pay");
  await pb.locator("#claim-expected").check();
  await pb.getByRole("button", { name: "Create claim link" }).click();
  await pb.locator(".code-wrap .code").waitFor();
  const claimUrl = (await pb.locator(".code-wrap .code").innerText()).trim();
  check(/\/claim\/[A-Za-z0-9_-]{22}$/.test(claimUrl), "the buyer got a claim link: " + claimUrl.replace(/\/claim\/(.{4}).*/, "/claim/$1…"));
  await pb.screenshot({ path: path.join(shots, "07-claim-link-created.png") });

  // The supplier has no Misthos account: a clean browser, only the wallet.
  const ctxS = await newCtx();
  const ps = await ctxS.newPage();
  watch(ps);
  await ps.goto(claimUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await ps.getByText("You receive now").waitFor();
  check((await ps.getByText("$2,500.00").count()) > 0, "the claim page shows the invoice amount from the server");
  check((await ps.getByText("you are simply paid early").count()) > 0, "at 0% it says so plainly: no discount, paid early");
  check((await ps.getByText(supplier.slice(0, 6)).count()) > 0, "it shows the payout address, the invoice's own supplier wallet");
  await ps.evaluate((a) => window.__connectAs(a), buyer);
  await ps.locator(".wallet-card", { hasText: "Test wallet" }).click();
  await ps.getByText("This is not the wallet this invoice pays").waitFor();
  check(true, "a wallet that is not the payout address cannot accept");
  await ps.evaluate((a) => window.__switchTo(a), supplier);
  await ps.getByRole("button", { name: "Accept and sign" }).click();
  await ps.getByText("The buyer has been sent your offer").waitFor();
  check(true, "the supplier signed with their wallet, no account");
  await ps.screenshot({ path: path.join(shots, "08-claim-signed.png") });
  await ps.reload();
  await ps.getByText("This link was already used").waitFor();
  check(true, "the link is single use");

  // The buyer reviews and pays with the stored signature.
  await pb.goto(`${BASE}/buyer`, { waitUntil: "networkidle" });
  await pb.getByText("Signed: ready to pay").waitFor({ timeout: 30_000 });
  // This buyer has never paid this address, so the signed offer is held back until they confirm it.
  await pb.getByText("First payment to this address").waitFor({ timeout: 30_000 });
  check((await pb.getByRole("button", { name: "Review and pay" }).count()) === 0, "before confirming, there is no way to pay: the signed offer is not released");
  await pb.getByRole("button", { name: "Yes, this is the right address" }).click();
  await pb.getByRole("button", { name: "Review and pay" }).waitFor({ timeout: 30_000 });
  check(true, "after confirming the address, the signed offer is released");
  await pb.getByRole("button", { name: "Review and pay" }).click();
  await pb.getByText("You pay in total").waitFor({ timeout: 30_000 });
  const allow = pb.locator(".modal button", { hasText: "Allow Misthos to use your USDC" });
  if (await allow.isVisible()) {
    await allow.click();
    await pb.locator(".modal button:text-is('Pay early')").waitFor({ timeout: 60_000 });
  }
  await pb.locator(".modal button:text-is('Pay early')").click();
  const settledLogs = await (async () => {
    for (let i = 0; i < 60; i++) {
      const l = await rpc("eth_getLogs", [{ address: dep.invoiceBook, fromBlock: "0x0", toBlock: "latest", topics: [keccak256(toHex("EarlySettled(bytes32,uint256,uint256,uint16,uint256,bytes32)")), relayedId] }]);
      if (l.length) return l;
      await sleep(500);
    }
    return [];
  })();
  check(settledLogs.length === 1, "the buyer paid with the stored signature: EarlySettled on the chain");
  const discountWord = BigInt("0x" + settledLogs[0].data.slice(2 + 64, 2 + 128));
  check(discountWord === 0n, "cleared at a price of zero: the supplier was simply paid early");
  await ctxB.close();
  await ctxS.close();

  log("10. sign out");
  await page.goto(`${BASE}/app`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await text("Sign in with your wallet").waitFor();
  const me3 = await page.evaluate(async (u) => (await (await fetch(`${u}/api/me`, { credentials: "include" })).json()).data, API_URL);
  check(me3 === null, "signed out on the server too");

  check(errors.length === 0, `no console errors in the app${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await browser.close();
  console.log("\nE2E ACCOUNTS PASSED");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => { restoreTsconfig(); for (const p of procs) p.kill(); for (const s of servers) s.close(); setTimeout(() => process.exit(process.exitCode ?? 0), 500); });

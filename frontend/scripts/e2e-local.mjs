// End-to-end test on a REAL local chain (Anvil), with the real contract and the real built app, driving the real UI.
//   pnpm --filter @misthos/frontend e2e:local
// Only the browser wallet is a stand-in: a tiny EIP-1193 provider that forwards every call, including signing and sending,
// to Anvil's unlocked test accounts. Nothing is mocked in the app, the contract, or the chain. Screenshots go to ./shots/e2e.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const MNEMONIC = "test test test test test test test test test test test junk";
const RPC = "http://127.0.0.1:8545";
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const root = path.resolve(import.meta.dirname, "..", "..");
const shots = path.resolve(import.meta.dirname, "..", "shots", "e2e");
fs.mkdirSync(shots, { recursive: true });
const acct = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }).address.toLowerCase();
const [supplier, buyer] = [acct(1), acct(2)];

const procs = [];
let pageRef;
const pageErrors = [];
const log = (m) => console.log(`\n== ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { throw new Error(`E2E FAILED: ${m}`); };
const check = (cond, m) => { if (!cond) fail(m); console.log(`  ok  ${m}`); };

async function waitFor(fn, what, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return; } catch { /* retry */ }
    await sleep(400);
  }
  fail(`timed out waiting for ${what}`);
}
const rpc = async (method, params = []) => (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

// ---- the wallet stand-in injected before any page script runs ----
const WALLET_SCRIPT = `(() => {
  let current = sessionStorage.getItem("__acct");
  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  const rpc = async (method, params) => {
    const r = await fetch("${RPC}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  };
  const provider = {
    request: async ({ method, params = [] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return current ? [current] : [];
      if (method === "eth_chainId") return "0x7a69";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "eth_sendTransaction") return rpc(method, [{ ...params[0], from: current }]);
      return rpc(method, params);
    },
    on(e, f) { (listeners[e] ||= []).push(f); },
    removeListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
  };
  window.__setAccount = (a) => { current = a; sessionStorage.setItem("__acct", a); emit("accountsChanged", [a]); };
  window.__connectAs = (a) => { current = a; sessionStorage.setItem("__acct", a); };
  window.addEventListener("eip6963:requestProvider", () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "e2e-wallet", name: "Test wallet", icon: "", rdns: "test.e2e" }, provider }) })));
})();`;

async function main() {
  log("1. start a real local chain");
  const anvil = spawn("anvil", ["--silent", "--port", "8545", "--chain-id", "31337"], { stdio: "ignore" });
  procs.push(anvil);
  await waitFor(async () => (await rpc("eth_chainId")) === "0x7a69", "anvil");
  check(true, "anvil is up on chain id 31337");

  log("2. deploy the real contract");
  execFileSync("forge", ["script", "script/DeployLocal.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: path.join(root, "contract"), stdio: "pipe" });
  const dep = JSON.parse(fs.readFileSync(path.join(root, "contract", "deployments", "31337.json"), "utf8"));
  check(/^0x[0-9a-fA-F]{40}$/.test(dep.invoiceBook), `InvoiceBook deployed at ${dep.invoiceBook}`);

  log("3. build the app against it");
  const env = { ...process.env, NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_CHAIN_ID: "31337", NEXT_PUBLIC_RPC_URL: RPC, NEXT_PUBLIC_INVOICE_BOOK_ADDRESS: dep.invoiceBook, NEXT_PUBLIC_USDC_ADDRESS: dep.usdc, NEXT_PUBLIC_DEPLOY_BLOCK: String(dep.deployBlock), NEXT_PUBLIC_EXPLORER_URL: "http://localhost:1" };
  const cwd = path.resolve(import.meta.dirname, "..");
  const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
  execFileSync(process.execPath, [nextBin, "build"], { cwd, env, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd, env, stdio: "ignore" });
  procs.push(server);
  await waitFor(async () => (await fetch(BASE)).ok, "next start");
  check(true, `app serving on ${BASE}`);

  const chain = createPublicClient({ transport: http(RPC) });
  const book = parseAbi([
    "function invoices(bytes32) view returns (address supplier, address buyer, address token, uint128 amount, uint64 dueDate, uint64 approvedAt, uint8 status)",
    "event EarlySettled(bytes32 indexed id, uint256 net, uint256 discount, uint16 rateBps, uint256 fee, bytes32 decisionHash)",
  ]);
  const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const bal = (a) => chain.readContract({ address: dep.usdc, abi: usdcAbi, functionName: "balanceOf", args: [a] });

  const browser = await chromium.launch({ channel: "msedge", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(WALLET_SCRIPT);
  const page = await ctx.newPage();
  pageRef = page;
  const errors = pageErrors;
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const u = m.location().url ?? "";
    if (/:410[12]/.test(u) || /:410[12]/.test(m.text())) return; // the agents are not running in this test
    errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = (n) => page.screenshot({ path: path.join(shots, `${n}.png`) });
  const asAccount = async (a) => { await page.evaluate((x) => window.__setAccount(x), a); await sleep(500); };

  log("4. connect a wallet through the real Connect wallet button");
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await page.evaluate((a) => window.__connectAs(a), supplier);
  await shot("01-start-here-disconnected");
  await page.locator(".topbar button", { hasText: "Connect wallet" }).click();
  await page.locator(".wallet-option", { hasText: "Test wallet" }).click();
  await page.locator(".wallet-pill").waitFor();
  check((await page.locator(".wallet-pill").innerText()).includes(supplier.slice(2, 6)), "wallet connected as the supplier");
  await shot("02-start-here-connected");

  log("5. supplier: empty state, then create and sign an invoice");
  await page.goto(`${BASE}/supplier`, { waitUntil: "networkidle" });
  check(await page.getByText("No invoices yet. Create your first invoice.").isVisible(), "supplier sees an honest empty state");
  await shot("03-supplier-empty");
  await page.goto(`${BASE}/supplier/invoices/new`, { waitUntil: "networkidle" });
  const dueDay = new Date(Date.now() + 27 * 86_400_000).toISOString().slice(0, 10);
  await page.fill("#buyer", buyer);
  await page.fill("#amount", "2000");
  await page.fill("#due", dueDay);
  await page.fill("#ref", "PO-2043");
  await page.fill("#note", "October delivery");
  await page.locator(".preview").waitFor();
  await shot("04-new-invoice-filled");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/invoices\/0x[0-9a-f]{64}/, { timeout: 60_000 });
  const invoiceId = page.url().split("/").pop();
  await page.getByText("Registered", { exact: false }).first().waitFor();
  const onchain = await chain.readContract({ address: dep.invoiceBook, abi: book, functionName: "invoices", args: [invoiceId] });
  check(onchain[0].toLowerCase() === supplier && onchain[1].toLowerCase() === buyer && onchain[3] === 2_000_000_000n && onchain[6] === 1, "the chain holds the registered invoice (status Registered, $2,000)");
  await shot("05-invoice-registered");

  log("6. buyer: approvals page, approve the invoice");
  await asAccount(buyer);
  await page.goto(`${BASE}/buyer/approvals`, { waitUntil: "networkidle" });
  await page.getByText("Approve invoice").first().waitFor();
  await shot("06-buyer-approvals");
  await page.locator("button", { hasText: "Approve invoice" }).first().click();
  await waitFor(async () => (await chain.readContract({ address: dep.invoiceBook, abi: book, functionName: "invoices", args: [invoiceId] }))[6] === 2, "invoice approved on chain");
  check(true, "buyer approved: on-chain status is Approved");

  log("7. supplier: sign an early-payment offer at 10%");
  await asAccount(supplier);
  await page.goto(`${BASE}/invoices/${invoiceId}`, { waitUntil: "networkidle" });
  await page.getByText("Sign an early-payment offer").waitFor();
  await shot("07-invoice-approved-supplier");
  await page.getByText("Sign an early-payment offer").click();
  await page.fill("#rate", "10");
  await shot("08-sign-offer-modal");
  await page.locator(".modal button", { hasText: "Sign offer" }).click();
  await page.locator(".modal .code").waitFor();
  const code = (await page.locator(".modal .code").innerText()).trim();
  check(code.startsWith("misthos-offer-1:"), "the supplier received a signed offer code");
  await shot("09-offer-code");
  await page.locator(".modal button", { hasText: "Done" }).click();

  log("8. buyer: paste the code, review the terms, allow USDC, pay early");
  await asAccount(buyer);
  await page.goto(`${BASE}/invoices/${invoiceId}`, { waitUntil: "networkidle" });
  const supplierBefore = await bal(supplier);
  const buyerBefore = await bal(buyer);
  await page.getByText("Pay early with an offer code").click();
  await page.fill("#offer-code", code);
  await page.getByText("You pay in total").waitFor({ timeout: 30_000 });
  await shot("10-pay-early-terms");
  const allow = page.locator(".modal button", { hasText: "Allow Misthos to use your USDC" });
  if (await allow.isVisible()) {
    await allow.click();
    await page.locator(".modal button:text-is('Pay early')").waitFor({ timeout: 60_000 });
  }
  await page.locator(".modal button:text-is('Pay early')").click();
  await waitFor(async () => (await chain.readContract({ address: dep.invoiceBook, abi: book, functionName: "invoices", args: [invoiceId] }))[6] === 3, "invoice settled early on chain", 90_000);
  check(true, "settled early: on-chain status is SettledEarly");

  log("9. verify the money against the contract's own event");
  const logs = await chain.getContractEvents({ address: dep.invoiceBook, abi: book, eventName: "EarlySettled", fromBlock: BigInt(dep.deployBlock) });
  check(logs.length === 1, "exactly one EarlySettled event");
  const { net, discount, rateBps, fee } = logs[0].args;
  check(net + discount === 2_000_000_000n, `net ${formatUnits(net, 6)} + discount ${formatUnits(discount, 6)} = $2,000.00 face`);
  check(rateBps === 1000 && fee === (discount * 1000n) / 10_000n, "rate 10.00% and the success fee is 10% of the discount");
  check((await bal(supplier)) - supplierBefore === net, "the supplier received exactly the net amount");
  check(buyerBefore - (await bal(buyer)) === net + fee, "the buyer paid net plus fee, nothing else");
  await page.getByText("Paid early").first().waitFor();
  await shot("11-invoice-paid");

  log("10. every page renders with real data, desktop and phone");
  const pages = ["/", "/app", "/supplier", "/buyer", "/buyer/approvals", "/buyer/policy", "/invoices", `/invoices/${invoiceId}`, "/ledger", "/stats", "/agents", "/kit", "/claim/abc123token"];
  for (const p of pages) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    await sleep(900);
    const name = p === "/" ? "landing" : p.replace(/\/0x[0-9a-f]{64}/, "/id").replace(/\//g, "-").replace(/^-/, "");
    await shot(`20-${name}`);
    check((await page.locator("h1, .display").first().innerText()).length > 0, `${p} renders a heading`);
  }
  await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
  await sleep(1500);
  const statsText = await page.locator(".lead").first().innerText();
  check(/1 invoice was paid .* early, moving \$/.test(statsText), `stats headline is computed from the chain: "${statsText}"`);
  await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
  await page.getByText("Debits equal credits for every invoice").waitFor({ timeout: 20_000 });
  check(true, "the ledger journal balances");
  await shot("21-ledger-journal");

  const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await phone.addInitScript(WALLET_SCRIPT);
  const mp = await phone.newPage();
  for (const p of ["/", "/app", "/buyer", `/invoices/${invoiceId}`, "/stats"]) {
    await mp.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    await sleep(900);
    await mp.screenshot({ path: path.join(shots, `30-phone-${p === "/" ? "landing" : p.replace(/\/0x[0-9a-f]{64}/, "/id").replace(/\//g, "-").replace(/^-/, "")}.png`) });
  }

  if (process.env.E2E_THEMES) {
    log("11. the real app pages in every colour theme");
    const themes = ["violet-night", "violet-light", "midnight-coral", "emerald"];
    for (const t of themes) {
      for (const [name, p, who] of [["invoice", `/invoices/${invoiceId}`, buyer], ["buyer", "/buyer", buyer], ["stats", "/stats", buyer], ["new", "/supplier/invoices/new", supplier]]) {
        await page.evaluate((x) => window.__connectAs(x), who);
        await page.goto(`${BASE}${p}?theme=${t}`, { waitUntil: "networkidle" });
        await sleep(1400);
        await page.screenshot({ path: path.join(shots, `theme-${t}-${name}.png`) });
      }
    }
    check(true, "captured the app in 4 themes");
  }
  check(errors.length === 0, `no console errors in the app${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await browser.close();
  console.log("\nE2E PASSED");
}

try {
  await main();
} catch (e) {
  console.error(String(e.stack ?? e));
  if (pageRef) {
    try {
      await pageRef.screenshot({ path: path.join(shots, "FAILED.png") });
      console.error("page url:", pageRef.url());
      console.error("browser errors:", pageErrors.slice(0, 5));
      console.error("page text:", (await pageRef.locator("body").innerText()).slice(0, 900));
    } catch { /* page already closed */ }
  }
  process.exitCode = 1;
} finally {
  for (const p of procs) try { p.kill(); } catch { /* already gone */ }
}

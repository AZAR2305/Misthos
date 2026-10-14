import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { chainHandlers, createViemRelayer } from "../src/relayer";
import { getCursor, indexOnce, loadInvoices } from "../src/indexer";
import { runNextJob } from "../src/jobs";
import { INVOICE_BOOK_ABI, domain, invoiceId, invoiceTypedData, offerTypedData } from "../src/shared";
import { browser, makeApp, onboard, wallet } from "./helpers";

/**
 * The real thing: an Anvil chain, the real InvoiceBook contract, the real indexer, relayer and API. Only the wallet pop-up (which cannot
 * run headless) and the browser wallet's key (a deterministic Anvil test account) are stand-ins.
 */
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const contractDir = path.resolve(import.meta.dirname, "..", "..", "contract");
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC), cacheTime: 0 }); // no cached block number: the indexer must see the head as it is
const walletClient = (i: number) => createWalletClient({ account: wallet(i), chain, transport: http(RPC) });
const keyOf = (i: number) => toHex(wallet(i).getHdKey().privateKey!);

let anvil: ChildProcess;
let dep: { invoiceBook: Address; usdc: Address; deployBlock: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  anvil = spawn("anvil", ["--silent", "--port", String(PORT), "--chain-id", "31337"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await pub.getChainId()) === 31337) break;
    } catch {
      await sleep(200);
    }
  }
  execFileSync("forge", ["script", "script/DeployLocal.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: contractDir, stdio: "pipe" });
  dep = JSON.parse(readFileSync(path.join(contractDir, "deployments", "31337.json"), "utf8"));
}, 120_000);

afterAll(() => {
  anvil?.kill();
});

describe("API, indexer and relayer against a real chain", () => {
  it("registers through the relayer, indexes every event, and reports numbers that match the contract", async () => {
    const env = { ARC_RPC_URL: RPC, ARC_CHAIN_ID: "31337", INVOICE_BOOK_ADDRESS: dep.invoiceBook, USDC_ADDRESS: dep.usdc, DEPLOY_BLOCK: String(dep.deployBlock) };
    const relayer = createViemRelayer({ privateKey: keyOf(3), rpcUrl: RPC, chain, book: dep.invoiceBook, publicClient: pub });
    const { app, db, config, google } = await makeApp({ client: pub, relayer, env });
    const handlers = chainHandlers({ relayer, publicClient: pub, book: dep.invoiceBook });
    const index = () => indexOnce({ db, client: pub, book: dep.invoiceBook, startBlock: config.DEPLOY_BLOCK });

    const supplier = browser(app);
    const buyer = browser(app);
    await onboard(supplier, google, { sub: "s", email: "supplier@example.com", walletIndex: 1, side: "supplier" });
    await onboard(buyer, google, { sub: "b", email: "buyer@example.com", walletIndex: 2, side: "buyer" });

    // Nothing is invented: before any event, the API reports an empty chain.
    await index();
    expect((await supplier.get("/api/invoices")).json.data).toEqual({ total: 0, items: [] });
    expect((await supplier.get("/api/stats")).json.data.summary.count).toBe(0);

    // ---- the supplier signs an invoice and asks the relayer to register it
    const dom = domain(31337, dep.invoiceBook);
    const due = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
    const msg = { supplier: wallet(1).address.toLowerCase() as Address, buyer: wallet(2).address.toLowerCase() as Address, token: dep.usdc.toLowerCase() as Address, amount: 2_000_000_000n, dueDate: due, refHash: keccak256(toHex("PO-2043")), nonce: 1n };
    const wire = { supplier: msg.supplier, buyer: msg.buyer, token: msg.token, amount: msg.amount.toString(), dueDate: msg.dueDate.toString(), refHash: msg.refHash, nonce: "1" };
    const signature = await wallet(1).signTypedData(invoiceTypedData(dom, msg));
    const id = invoiceId(dom, msg);

    const forged = await supplier.post("/api/relay/register", { invoice: wire, signature: await wallet(5).signTypedData(invoiceTypedData(dom, msg)) });
    expect(forged.json.error.code).toBe("BAD_SIGNATURE");
    const notMine = await supplier.post("/api/relay/register", { invoice: { ...wire, supplier: wallet(4).address.toLowerCase() }, signature });
    expect(notMine.json.error.code).toBe("NOT_YOUR_INVOICE");
    expect((await buyer.post("/api/relay/register", { invoice: wire, signature })).json.error.code).toBe("WRONG_SIDE");

    const first = await supplier.post("/api/relay/register", { invoice: wire, signature });
    expect(first.status).toBe(202);
    expect(first.json.data.invoiceId).toBe(id);
    const second = await supplier.post("/api/relay/register", { invoice: wire, signature });
    expect(second.json.data.jobId).toBe(first.json.data.jobId); // same key, same job: nothing is sent twice
    expect(second.json.data.created).toBe(false);

    const job = await runNextJob(db, handlers);
    expect(job?.status).toBe("done");
    expect(await runNextJob(db, handlers)).toBeNull();
    const status = (await pub.readContract({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, functionName: "invoices", args: [id] }))[6];
    expect(status).toBe(1); // Registered, on the real contract

    const after = await supplier.post("/api/relay/register", { invoice: wire, signature });
    expect(after.status).toBe(200);
    expect(after.json.data.alreadyRegistered).toBe(true);

    expect((await supplier.get(`/api/jobs/${first.json.data.jobId}`)).json.data).toMatchObject({ status: "done", attempts: 1 });
    expect((await buyer.get(`/api/jobs/${first.json.data.jobId}`)).status).toBe(404); // someone else's job

    // ---- the buyer approves and pays early; the supplier signed the offer
    const buyerWallet = walletClient(2);
    await buyerWallet.writeContract({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, functionName: "approveInvoice", args: [id] });
    const offer = { invoiceId: id, rateBps: 1000, expiry: BigInt(Math.floor(Date.now() / 1000) + 3600), nonce: 7n };
    const offerSig = await wallet(1).signTypedData(offerTypedData(dom, offer));
    const erc20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
    await buyerWallet.writeContract({ address: dep.usdc, abi: erc20, functionName: "approve", args: [dep.invoiceBook, 10_000_000_000n] });
    const decisionHash = keccak256(toHex("decision-1")) as Hex;
    const settleTx = await buyerWallet.writeContract({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, functionName: "settleEarly", args: [id, offer, offerSig, decisionHash] });
    await pub.waitForTransactionReceipt({ hash: settleTx });

    // ---- index everything and check every public number against the chain's own event
    const run = await index();
    expect(run?.events).toBe(3); // registered, approved, settled
    expect(await index()).toBeNull(); // caught up

    const list = (await supplier.get("/api/invoices?status=settled_early")).json.data;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ id, supplier: msg.supplier, buyer: msg.buyer, amount: "2000000000", status: "settled_early" });
    expect((await supplier.get(`/api/invoices?buyer=${wallet(5).address}`)).json.data.total).toBe(0);
    const detail = (await supplier.get(`/api/invoices/${id}`)).json.data;
    expect(detail.events.map((e: { name: string }) => e.name)).toEqual(["InvoiceRegistered", "InvoiceApproved", "EarlySettled"]);

    const [log] = await pub.getContractEvents({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, eventName: "EarlySettled", fromBlock: BigInt(dep.deployBlock) });
    const { net, discount, fee, rateBps } = log!.args as { net: bigint; discount: bigint; fee: bigint; rateBps: number };
    const stats = (await supplier.get("/api/stats")).json.data;
    expect(stats.source).toBe("sandbox");
    expect(stats.summary).toMatchObject({ count: 1, face: "2000000000", net: net.toString(), discount: discount.toString(), fee: fee.toString() });
    expect(BigInt(stats.settlements[0].net) + BigInt(stats.settlements[0].discount)).toBe(2_000_000_000n);
    expect(stats.settlements[0].rateBps).toBe(rateBps);
    expect(stats.settlements[0].daysEarly).toBeGreaterThanOrEqual(29);

    const ledger = (await buyer.get("/api/ledger")).json.data; // defaults to the signed-in buyer's wallet
    expect(ledger.balanced).toBe(true);
    expect(ledger.lines.length).toBeGreaterThanOrEqual(3);
    const csv = await buyer.get("/api/ledger.csv");
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.text.split("\n")[0]).toBe("date,invoice,account,debit,credit,memo,tx");
    expect((await buyer.get("/api/ledger.beancount")).text).toContain('option "operating_currency" "USDC"');
    const supplierLedger = (await supplier.get("/api/ledger")).json.data; // the supplier side of the same settlement
    expect(supplierLedger.balanced).toBe(true);
    expect(supplierLedger.lines.map((l: { account: string }) => l.account)).toContain("Accounts receivable");
    expect((await app.request(`/api/ledger?side=buyer&address=${msg.buyer}`)).status).toBe(200); // public: any address, no sign-in

    // ---- re-reading history from the start changes nothing: events are unique on (tx_hash, log_index)
    const before = (await loadInvoices(db)).length;
    await db.query("delete from indexer_state");
    const again = await index();
    expect(again?.events).toBe(0);
    expect((await loadInvoices(db)).length).toBe(before);
    expect(await getCursor(db)).toBe(await pub.getBlockNumber());

    // ---- the shared store is a rebuildable cache: wipe every chain-derived table, re-index from the chain, and get the same answers
    const snapshot = async () => ({
      stats: (await supplier.get("/api/stats")).json.data,
      invoices: (await supplier.get("/api/invoices")).json.data,
      buyerLedger: (await buyer.get("/api/ledger")).json.data,
      supplierLedger: (await supplier.get("/api/ledger")).json.data,
      csv: (await buyer.get("/api/ledger.csv")).text,
      beancount: (await buyer.get("/api/ledger.beancount")).text,
    });
    const original = await snapshot();
    await db.query("delete from chain_events");
    await db.query("delete from chain_blocks");
    await db.query("delete from indexer_state");
    const wiped = await snapshot();
    expect(wiped.stats.summary.count).toBe(0); // the cache really was emptied
    expect(wiped.invoices).toEqual({ total: 0, items: [] });
    for (let i = 0; i < 20 && (await index()); i++); // catch up from the deploy block, in batches
    expect(await snapshot()).toEqual(original); // identical: stats, invoices, both ledgers, the CSV and the Beancount export

    const health = (await supplier.get("/api/health")).json.data;
    expect(health).toMatchObject({ db: { ok: true }, rpc: { ok: true }, contract: { configured: true }, relayer: { configured: true } });
    expect(health.indexer.lag).toBe("0");
  }, 180_000);
});

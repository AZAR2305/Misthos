import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, toHex, type Address } from "viem";
import { indexOnce } from "../src/indexer";
import { INVOICE_BOOK_ABI, domain, invoiceId, invoiceTypedData, offerTypedData } from "../src/shared";
import { ORIGIN, browser, makeApp, onboard, wallet } from "./helpers";

/** Claim links against a real Anvil chain and the real contract: the stored signature must be accepted by settleEarly. */
const PORT = 8548;
const RPC = `http://127.0.0.1:${PORT}`;
const contractDir = path.resolve(import.meta.dirname, "..", "..", "contract");
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC), cacheTime: 0 });
const wc = (i: number) => createWalletClient({ account: wallet(i), chain, transport: http(RPC) });

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

describe("claim links", () => {
  it("a buyer invites a supplier with no account, the supplier signs, and the contract accepts that exact signature", async () => {
    const env = { ARC_RPC_URL: RPC, ARC_CHAIN_ID: "31337", INVOICE_BOOK_ADDRESS: dep.invoiceBook, USDC_ADDRESS: dep.usdc, DEPLOY_BLOCK: String(dep.deployBlock), RATE_LIMIT_PER_MIN: "200" };
    const { app, db, config, google } = await makeApp({ client: pub, env });
    const index = () => indexOnce({ db, client: pub, book: dep.invoiceBook, startBlock: config.DEPLOY_BLOCK });
    const buyer = browser(app);
    await onboard(buyer, google, { sub: "cb", email: "claim-buyer@example.com", walletIndex: 6, side: "buyer" });

    // A supplier (wallet 5) signs an invoice; anyone may register it; the buyer (wallet 6) approves it.
    const dom = domain(31337, dep.invoiceBook);
    const msg = {
      supplier: wallet(5).address.toLowerCase() as Address,
      buyer: wallet(6).address.toLowerCase() as Address,
      token: dep.usdc.toLowerCase() as Address,
      amount: 1_000_000_000n,
      dueDate: BigInt(Math.floor(Date.now() / 1000) + 20 * 86_400),
      refHash: keccak256(toHex("PO-CLAIM")),
      nonce: 11n,
    };
    const id = invoiceId(dom, msg);
    const reg = await wc(3).writeContract({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, functionName: "registerInvoice", args: [msg, await wallet(5).signTypedData(invoiceTypedData(dom, msg))] });
    await pub.waitForTransactionReceipt({ hash: reg });
    await index();

    // Not approved yet: no link.
    expect((await buyer.post("/api/standing-offers", { invoiceId: id, expectedSupplier: msg.supplier, rateBps: 0 })).json.error.code).toBe("NOT_APPROVED");
    await pub.waitForTransactionReceipt({ hash: await wc(6).writeContract({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, functionName: "approveInvoice", args: [id] }) });
    await index();

    // Another buyer cannot invite on this invoice; the real buyer gets a link, shown once.
    const stranger = browser(app);
    await onboard(stranger, google, { sub: "cs", email: "stranger@example.com", walletIndex: 7, side: "buyer" });
    expect((await stranger.post("/api/standing-offers", { invoiceId: id, expectedSupplier: msg.supplier, rateBps: 0 })).json.error.code).toBe("NOT_YOUR_INVOICE");
    const made = await buyer.post("/api/standing-offers", { invoiceId: id, expectedSupplier: msg.supplier, rateBps: 0, validHours: 48 });
    expect(made.status).toBe(201);
    const token: string = made.json.data.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(made.json.data.claimUrl).toBe(`${ORIGIN}/claim/${token}`);
    expect((await buyer.post("/api/standing-offers", { invoiceId: id, expectedSupplier: msg.supplier, rateBps: 0 })).json.error.code).toBe("OPEN_LINK_EXISTS");

    // Only the hash is stored, never the token.
    const stored = await db.query<{ claim_token_hash: string }>("select claim_token_hash from standing_offers");
    expect(JSON.stringify(stored)).not.toContain(token);

    // The supplier has no account and no session: the link alone shows the terms and the payout address.
    const supplier = browser(app);
    const view = (await supplier.get(`/api/claims/${token}`)).json.data;
    expect(view.status).toBe("open");
    expect(view.invoice).toMatchObject({ id, amount: "1000000000", supplier: msg.supplier, buyer: msg.buyer });
    expect(view.offer.rateBps).toBe(0);
    expect((await supplier.get("/api/claims/not-a-real-token-12345")).status).toBe(404);

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3 * 3600);
    const offer = { invoiceId: id, rateBps: 0, expiry, nonce: 99n };
    const wire = { invoiceId: id, rateBps: 0, expiry: expiry.toString(), nonce: "99" };
    const sigOk = await wallet(5).signTypedData(offerTypedData(dom, offer));
    // A forwarded link in a stranger's hands: their signature is not the invoice supplier's, so it fails.
    expect((await supplier.post(`/api/claims/${token}/accept`, { offer: wire, signature: await wallet(8).signTypedData(offerTypedData(dom, offer)) })).json.error.code).toBe("BAD_SIGNATURE");
    // A different rate than the link offers is refused.
    const hi = { ...offer, rateBps: 500 };
    expect((await supplier.post(`/api/claims/${token}/accept`, { offer: { ...wire, rateBps: 500 }, signature: await wallet(5).signTypedData(offerTypedData(dom, hi)) })).json.error.code).toBe("OFFER_MISMATCH");

    expect((await supplier.post(`/api/claims/${token}/accept`, { offer: wire, signature: sigOk })).json.data).toEqual({ claimed: true });
    // Single use.
    expect((await supplier.post(`/api/claims/${token}/accept`, { offer: wire, signature: sigOk })).json.error.code).toBe("NOT_OPEN");
    expect((await supplier.get(`/api/claims/${token}`)).json.data).toEqual({ status: "claimed" });

    // This buyer has never settled with this address, so the signed offer is held back until they confirm it.
    const held = (await buyer.get("/api/standing-offers")).json.data;
    expect(held[0]).toMatchObject({ status: "claimed", newAddress: true, payoutConfirmed: false, signedOffer: null });
    expect((await buyer.post(`/api/standing-offers/${held[0].id}/confirm-payout`, { address: wallet(8).address })).json.error.code).toBe("ADDRESS_CHANGED");
    expect((await buyer.post(`/api/standing-offers/${held[0].id}/confirm-payout`, { address: msg.supplier })).json.data).toEqual({ confirmed: true });

    // The buyer sees the signed offer and settles with it: the contract accepts the signature the server stored.
    const mine = (await buyer.get("/api/standing-offers")).json.data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "claimed", invoiceId: id, payoutConfirmed: true });
    const signed = mine[0].signedOffer;
    expect(signed.supplier).toBe(msg.supplier);
    await pub.waitForTransactionReceipt({ hash: await wc(6).writeContract({ address: dep.usdc, abi: parseAbi(["function approve(address,uint256) returns (bool)"]), functionName: "approve", args: [dep.invoiceBook, 5_000_000_000n] }) });
    const settle = await wc(6).writeContract({
      address: dep.invoiceBook,
      abi: INVOICE_BOOK_ABI,
      functionName: "settleEarly",
      args: [id, { invoiceId: signed.offer.invoiceId, rateBps: signed.offer.rateBps, expiry: BigInt(signed.offer.expiry), nonce: BigInt(signed.offer.nonce) }, signed.sig, keccak256(toHex("claim-1"))],
    });
    expect((await pub.waitForTransactionReceipt({ hash: settle })).status).toBe("success");
    await index();
    expect((await supplier.get(`/api/invoices/${id}`)).json.data.invoice.status).toBe("settled_early");
    const [ev] = await pub.getContractEvents({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, eventName: "EarlySettled", args: { id }, fromBlock: BigInt(dep.deployBlock) });
    expect((ev!.args as { discount: bigint }).discount).toBe(0n); // cleared at 0%: the supplier was simply paid early

    // Declining and withdrawing, on a second invoice.
    const msg2 = { ...msg, refHash: keccak256(toHex("PO-CLAIM-2")), nonce: 12n };
    const id2 = invoiceId(dom, msg2);
    await pub.waitForTransactionReceipt({ hash: await wc(3).writeContract({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, functionName: "registerInvoice", args: [msg2, await wallet(5).signTypedData(invoiceTypedData(dom, msg2))] }) });
    await pub.waitForTransactionReceipt({ hash: await wc(6).writeContract({ address: dep.invoiceBook, abi: INVOICE_BOOK_ABI, functionName: "approveInvoice", args: [id2] }) });
    await index();
    const second = await buyer.post("/api/standing-offers", { invoiceId: id2, expectedSupplier: msg.supplier, rateBps: 200 });
    expect((await supplier.post(`/api/claims/${second.json.data.token}/decline`)).json.data).toEqual({ declined: true });
    expect((await supplier.get(`/api/claims/${second.json.data.token}`)).json.data).toEqual({ status: "withdrawn" });
    const third = await buyer.post("/api/standing-offers", { invoiceId: id2, expectedSupplier: msg.supplier, rateBps: 100 });
    expect((await buyer.del(`/api/standing-offers/${third.json.data.id}`)).json.data).toEqual({ withdrawn: true });
    expect((await supplier.get(`/api/claims/${third.json.data.token}`)).json.data).toEqual({ status: "withdrawn" });
  }, 180_000);
});

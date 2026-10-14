import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domain, offerTypedData, type BuyerPolicy, type Domain, MIN_OFFER_LIFE_SEC } from "../src/core/index.js";
import { BuyerAgent, DecisionStore, SupplierAgent, type AgentModel, type ChainReader, type OnChainInvoice, type ProposeArgs } from "../src/agents/index.js";
import { messageSchema, signReject, type OfferMsg } from "../src/protocol/index.js";
import { eoaVerifier, type ContractCall, type Eip712Payload, type WalletAdapter } from "../src/wallets/types.js";

/**
 * Offer life, on the REAL clock (no `now` override anywhere): the buyer reads its treasury, which takes real time, and an offer that no longer has
 * 60 seconds left is not settled; the supplier then signs that rung again. Only the chain and the model are stand-ins, as in the other agent tests.
 */
const USD = 1_000_000n;
const D: Domain = domain(5042002, "0x00000000000000000000000000000000000000aa");
const BOOK = "0x00000000000000000000000000000000000000aa" as const;
const INVOICE = ("0x" + "42".repeat(32)) as `0x${string}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const real = () => Math.floor(Date.now() / 1000);

function keyWallet(seed: string) {
  const account = privateKeyToAccount(keccak256(toHex(seed)));
  const calls: ContractCall[] = [];
  const wallet: WalletAdapter = {
    mode: "agent",
    address: async () => account.address,
    balance: async () => 0n,
    signTypedData: (p: Eip712Payload) => account.signTypedData(p as never),
    execute: async (call) => (calls.push(call), { txHash: ("0x" + "ab".repeat(32)) as `0x${string}`, raw: {} }),
    health: async () => ({ ok: true }),
  };
  return { wallet, account, calls };
}
class Scripted implements AgentModel {
  async propose<T>({ schema }: ProposeArgs<T>): Promise<T> {
    return schema.parse({ action: "accelerate_now", reason: "idle cash", evidence_refs: ["invoice"] });
  }
}

function world(treasuryDelayMs: number) {
  const supplier = keyWallet("supplier");
  const buyer = keyWallet("buyer");
  const due = BigInt(real() + 30 * 86_400);
  const onchain: OnChainInvoice = { supplier: supplier.account.address, buyer: buyer.account.address, token: "0x3600000000000000000000000000000000000000", amount: 2_000n * USD, dueDate: due, approvedAt: BigInt(real()), status: "approved" };
  const chain: ChainReader = { invoice: async (id) => (id === INVOICE ? onchain : undefined), offerNonceUsed: async () => false };
  const policy: BuyerPolicy = { hurdleAprBps: 0, liquidityFloor: 0n, perInvoiceCap: 0n, dailyCap: 0n, humanAbove: 0n, feeBps: 1000 };
  const buyerStore = new DecisionStore();
  const buyerAgent = new BuyerAgent({
    wallet: buyer.wallet, domain: D, model: new Scripted(), policy, store: buyerStore, chain, invoiceBook: BOOK, verifier: eoaVerifier,
    // A real, slow read: this is what eats into an offer's life.
    treasury: async () => (await sleep(treasuryDelayMs), { cash: 100_000n * USD, obligations: [] }),
  });
  return { supplier, buyer, buyerAgent, buyerStore, onchain };
}

/** An offer signed by the supplier wallet, with an exact life from the real clock. */
async function offerWithLife(w: ReturnType<typeof world>, lifeSec: number, nonce: bigint): Promise<OfferMsg> {
  const expiry = BigInt(real() + lifeSec);
  const payload = { invoiceId: INVOICE, rateBps: 0, expiry: expiry.toString(), nonce: nonce.toString() };
  const offerSig = await w.supplier.wallet.signTypedData(offerTypedData(D, { invoiceId: INVOICE, rateBps: 0, expiry, nonce }) as never);
  return { v: 1, type: "offer", invoiceId: INVOICE, rung: 0, offer: payload, offerSig, from: w.supplier.account.address, ts: real() };
}
const wire = (m: OfferMsg) => messageSchema.parse(JSON.parse(JSON.stringify(m))) as OfferMsg;

describe("an offer must have 60 seconds of life left to be settled", () => {
  it("the margin is 60 seconds", () => expect(MIN_OFFER_LIFE_SEC).toBe(60n));

  it("a slow treasury read that eats the offer's last seconds ends in EXPIRED and no settlement", async () => {
    const w = world(2_500); // a real 2.5 second read
    const reply = await w.buyerAgent.handleOffer(wire(await offerWithLife(w, 61, 1n))); // 61 seconds at signing, about 58 by the time it could settle
    expect(reply).toMatchObject({ type: "reject", reasonCode: "EXPIRED" });
    expect(w.buyer.calls).toHaveLength(0); // nothing was sent to the chain
    const entry = w.buyerStore.all().at(-1)!;
    expect(entry).toMatchObject({ outcome: "rejected", reasonCode: "EXPIRED" });
  }, 20_000);

  it("the same offer with room to spare is settled, once", async () => {
    const w = world(2_500);
    const reply = await w.buyerAgent.handleOffer(wire(await offerWithLife(w, 300, 2n)));
    expect(reply.type).toBe("accept");
    expect(w.buyer.calls).toHaveLength(1);
  }, 20_000);

  it("an offer that already has under 60 seconds is refused up front, with no read at all", async () => {
    const w = world(0);
    expect(await w.buyerAgent.handleOffer(wire(await offerWithLife(w, 30, 3n)))).toMatchObject({ type: "reject", reasonCode: "EXPIRED" });
    expect(w.buyer.calls).toHaveLength(0);
  });
});

describe("the supplier signs a rung again when the buyer says it is expiring", () => {
  it("re-signs the same rung with a new nonce and a fresh expiry, and settles on the new signature only", async () => {
    const w = world(0);
    const sent: OfferMsg[] = [];
    let first = true;
    const supplierStore = new DecisionStore();
    const supplierAgent = new SupplierAgent({
      wallet: w.supplier.wallet, domain: D, model: new Scripted(),
      prefs: { costOfWaitingAprBps: 2200, maxRateBps: 1000, startRateBps: 0, stepBps: 200 },
      store: supplierStore, buyerAgent: w.buyer.account.address, verifier: eoaVerifier, rungSeconds: 900,
      transport: async (msg) => {
        sent.push(msg);
        if (first) {
          first = false; // the buyer found the first signature too close to expiry (a real signed reject from the buyer's wallet)
          return signReject(w.buyer.wallet, D, { invoiceId: INVOICE, rung: msg.rung, reasonCode: "EXPIRED", ts: real() });
        }
        return w.buyerAgent.handleOffer(wire(msg));
      },
    });
    const result = await supplierAgent.start({ id: INVOICE, face: 2_000n * USD, dueSec: w.onchain.dueDate, status: "approved", pastAcceptedBps: [], buyer: w.buyer.account.address });
    expect(result).toMatchObject({ kind: "accepted", rung: 0, rateBps: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.rung).toBe(0);
    expect(sent[1]!.rung).toBe(0); // the SAME rung
    expect(sent[1]!.offer.nonce).not.toBe(sent[0]!.offer.nonce); // a new single-use nonce
    expect(sent[1]!.offerSig).not.toBe(sent[0]!.offerSig);
    // exactly one settlement, and it used the second signature
    expect(w.buyer.calls).toHaveLength(1);
    expect(String(w.buyer.calls[0]!.args[3])).toBe(sent[1]!.offer.nonce);
    expect(supplierAgent.transcript).toEqual([{ rung: 0, rateBps: 0, outcome: "accepted" }]);
    expect(supplierStore.all().some((e) => e.reasonCode === "EXPIRED")).toBe(true); // the re-sign is in the log
  });

  it("gives up after two re-signs instead of looping forever", async () => {
    const w = world(0);
    let calls = 0;
    const supplierAgent = new SupplierAgent({
      wallet: w.supplier.wallet, domain: D, model: new Scripted(),
      prefs: { costOfWaitingAprBps: 2200, maxRateBps: 400, startRateBps: 0, stepBps: 400 },
      store: new DecisionStore(), buyerAgent: w.buyer.account.address, verifier: eoaVerifier, rungSeconds: 900,
      transport: async (msg) => (calls++, signReject(w.buyer.wallet, D, { invoiceId: INVOICE, rung: msg.rung, reasonCode: "EXPIRED", ts: real() })),
    });
    await supplierAgent.start({ id: INVOICE, face: 2_000n * USD, dueSec: w.onchain.dueDate, status: "approved", pastAcceptedBps: [], buyer: w.buyer.account.address });
    expect(calls).toBeLessThanOrEqual(2 * 3); // at most 3 sends per rung (the first and two re-signs), over the rungs of this short ladder
    expect(w.buyer.calls).toHaveLength(0);
  });

  it("the offer outlives the wait for the buyer: expiry is at least the wait window plus 180 seconds", async () => {
    const w = world(0);
    const sent: OfferMsg[] = [];
    const agent = new SupplierAgent({
      wallet: w.supplier.wallet, domain: D, model: new Scripted(),
      prefs: { costOfWaitingAprBps: 2200, maxRateBps: 200, startRateBps: 0, stepBps: 200 },
      store: new DecisionStore(), buyerAgent: w.buyer.account.address, verifier: eoaVerifier,
      rungSeconds: 60, waitWindowSeconds: 600, // a short rung but a long wait: the wait decides
      transport: async (msg) => (sent.push(msg), signReject(w.buyer.wallet, D, { invoiceId: INVOICE, rung: msg.rung, reasonCode: "BELOW_HURDLE", ts: real() })),
    });
    const t0 = real();
    await agent.start({ id: INVOICE, face: 2_000n * USD, dueSec: w.onchain.dueDate, status: "approved", pastAcceptedBps: [], buyer: w.buyer.account.address });
    expect(sent.length).toBeGreaterThan(0);
    expect(Number(sent[0]!.offer.expiry) - t0).toBeGreaterThanOrEqual(600 + 180);
  });
});

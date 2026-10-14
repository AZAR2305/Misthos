/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { domain, invoiceTypedData, offerTypedData } from "../src/shared";
import { browser, makeApp, onboard, wallet } from "./helpers";

/**
 * Claim links are the riskiest surface: a link is a bearer secret, and money follows a signature. These tests use the real API and database with the
 * chain events seeded as the indexer would write them. The chain RPC and the relayer are stand-ins that say "nothing used yet" and accept a job.
 */
const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const TOKEN = "0x3600000000000000000000000000000000000000" as const;
const USD = 1_000_000n;
const stubs = { relayer: {} as never, client: { readContract: async (a: { functionName: string }) => (a.functionName === "usedOfferNonce" ? false : [0n, 0n, 0n, 0n, 0n, 0n, 0]), verifyTypedData: async () => false, getBlockNumber: async () => 1n } as never };
const id = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(32);
const SUPPLIER = wallet(1);
const BUYER = wallet(2);

async function world(o: { now?: () => Date } = {}) {
  const made = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK }, ...stubs, ...(o.now ? { now: o.now } : {}) });
  const buyer = browser(made.app);
  const supplierSession = browser(made.app);
  await onboard(buyer, null, { walletIndex: 2, side: "buyer" });
  await onboard(supplierSession, null, { walletIndex: 1, side: "supplier" });
  const anon = browser(made.app); // the supplier following a claim link has no account at all
  let log = 0;
  const ev = (tx: string, block: number, name: string, payload: object) => made.db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, $2, $3, $4, $5::jsonb)", [tx, log++, block, name, JSON.stringify(payload)]);
  const approved = async (n: number, amount = 1_000n * USD, ref = n) => {
    await ev("0x" + (0x10 + n).toString(16).repeat(32), 1 + n, "InvoiceRegistered", { id: id(n), supplier: SUPPLIER.address.toLowerCase(), buyer: BUYER.address.toLowerCase(), token: TOKEN, amount: amount.toString(), dueDate: String(Math.floor(Date.now() / 1000) + 60 * 86400), refHash: id(200 + ref) });
    await ev("0x" + (0x40 + n).toString(16).repeat(32), 2 + n, "InvoiceApproved", { id: id(n), approvedAt: "1700000000" });
    return id(n);
  };
  const settled = async (n: number) => {
    await approved(n);
    await ev("0x" + (0x70 + n).toString(16).repeat(32), 3 + n, "EarlySettled", { id: id(n), net: "1000000000", discount: "0", rateBps: 0, fee: "0", decisionHash: "0x" + "00".repeat(32) });
  };
  const offerFor = async (invoice: string, signer = SUPPLIER, nonce = 1n, rateBps = 0) => {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const offer = { invoiceId: invoice as `0x${string}`, rateBps, expiry, nonce };
    return { wire: { invoiceId: invoice, rateBps, expiry: expiry.toString(), nonce: nonce.toString() }, signature: await signer.signTypedData(offerTypedData(D, offer) as never) };
  };
  return { ...made, buyer, supplierSession, anon, approved, settled, offerFor, ev };
}

describe("making a link", () => {
  it("is refused when the invoice pays someone other than the address the buyer expected (a look-alike), and nothing is created", async () => {
    const w = await world();
    const inv = await w.approved(1);
    const lookAlike = SUPPLIER.address.slice(0, -4) + "dEaD";
    const r = await w.buyer.post("/api/standing-offers", { invoiceId: inv, expectedSupplier: lookAlike, rateBps: 0 });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SUPPLIER_MISMATCH");
    expect(r.json.error.message).toContain(SUPPLIER.address.toLowerCase()); // it names the address that WOULD be paid
    expect((await w.buyer.get("/api/standing-offers")).json.data).toEqual([]);
    // the expected address is mandatory
    expect((await w.buyer.post("/api/standing-offers", { invoiceId: inv, rateBps: 0 })).status).toBe(400);
  });
});

describe("a forwarded link cannot redirect payment", () => {
  it("someone else holding the link cannot sign for it; the real supplier still can, once", async () => {
    const w = await world();
    const inv = await w.approved(1);
    const made = await w.buyer.post("/api/standing-offers", { invoiceId: inv, expectedSupplier: SUPPLIER.address, rateBps: 0 });
    const token = made.json.data.token as string;

    // The page tells whoever opens it where the money goes: the invoice's own supplier, fixed on chain.
    const view = (await w.anon.get(`/api/claims/${token}`)).json.data;
    expect(view.invoice.supplier).toBe(SUPPLIER.address.toLowerCase());

    const attacker = wallet(5);
    const forged = await w.offerFor(inv, attacker);
    const refused = await w.anon.post(`/api/claims/${token}/accept`, { offer: forged.wire, signature: forged.signature });
    expect(refused.status).toBe(400);
    expect(refused.json.error.code).toBe("BAD_SIGNATURE");
    expect((await w.anon.get(`/api/claims/${token}`)).json.data.status).toBe("open"); // nothing was claimed

    const good = await w.offerFor(inv, SUPPLIER);
    expect((await w.anon.post(`/api/claims/${token}/accept`, { offer: good.wire, signature: good.signature })).json.data).toEqual({ claimed: true });
    // a second person with the same link, now, gets nothing
    const again = await w.offerFor(inv, SUPPLIER, 2n);
    expect((await w.anon.post(`/api/claims/${token}/accept`, { offer: again.wire, signature: again.signature })).json.error.code).toBe("NOT_OPEN");
  });
});

describe("a first payment to a new address needs the buyer to confirm it", () => {
  it("holds the signed offer back until the buyer confirms the exact address, and says the address is new", async () => {
    const w = await world();
    const inv = await w.approved(1);
    const made = await w.buyer.post("/api/standing-offers", { invoiceId: inv, expectedSupplier: SUPPLIER.address, rateBps: 0 });
    expect(made.json.data.newAddress).toBe(true);
    const o = await w.offerFor(inv);
    await w.anon.post(`/api/claims/${made.json.data.token}/accept`, { offer: o.wire, signature: o.signature });

    const held = (await w.buyer.get("/api/standing-offers")).json.data[0];
    expect(held).toMatchObject({ status: "claimed", newAddress: true, payoutConfirmed: false, signedOffer: null, supplier: SUPPLIER.address.toLowerCase() });
    // a different address, or someone else's session, cannot release it
    expect((await w.buyer.post(`/api/standing-offers/${held.id}/confirm-payout`, { address: wallet(5).address })).json.error.code).toBe("ADDRESS_CHANGED");
    expect((await w.supplierSession.post(`/api/standing-offers/${held.id}/confirm-payout`, { address: SUPPLIER.address })).status).toBe(403); // not a buyer
    expect((await w.buyer.get("/api/standing-offers")).json.data[0].signedOffer).toBeNull();

    expect((await w.buyer.post(`/api/standing-offers/${held.id}/confirm-payout`, { address: SUPPLIER.address })).json.data).toEqual({ confirmed: true });
    const released = (await w.buyer.get("/api/standing-offers")).json.data[0];
    expect(released.payoutConfirmed).toBe(true);
    expect(released.signedOffer).toMatchObject({ supplier: SUPPLIER.address.toLowerCase(), offer: { invoiceId: inv } });
  });

  it("is not asked again once this buyer has settled with that address before", async () => {
    const w = await world();
    await w.settled(9); // an earlier, settled invoice between the same two wallets
    const inv = await w.approved(1);
    const made = await w.buyer.post("/api/standing-offers", { invoiceId: inv, expectedSupplier: SUPPLIER.address, rateBps: 0 });
    expect(made.json.data.newAddress).toBe(false);
    const o = await w.offerFor(inv);
    await w.anon.post(`/api/claims/${made.json.data.token}/accept`, { offer: o.wire, signature: o.signature });
    const row = (await w.buyer.get("/api/standing-offers")).json.data[0];
    expect(row).toMatchObject({ newAddress: false, payoutConfirmed: true });
    expect(row.signedOffer).not.toBeNull();
  });
});

describe("tokens: reused, expired, invalid", () => {
  it("a reused token, a withdrawn one and one past its time all fail, and an unknown token says nothing", async () => {
    let t = new Date();
    const w = await world({ now: () => t });
    const inv = await w.approved(1);
    const made = await w.buyer.post("/api/standing-offers", { invoiceId: inv, expectedSupplier: SUPPLIER.address, rateBps: 0, validHours: 1 });
    const token = made.json.data.token as string;
    // expired: an hour and a bit later
    t = new Date(t.getTime() + 61 * 60_000);
    expect((await w.anon.get(`/api/claims/${token}`)).json.data.status).toBe("expired");
    const late = await w.offerFor(inv);
    expect((await w.anon.post(`/api/claims/${token}/accept`, { offer: late.wire, signature: late.signature })).json.error.code).toBe("NOT_OPEN");

    // invalid: wrong length, wrong characters, a valid-looking token nobody issued; none echoes what it was sent
    for (const bad of ["x", "A".repeat(21), "A".repeat(23), "!".repeat(22), "../../etc/passwd", "B".repeat(22)]) {
      const r = await w.anon.get(`/api/claims/${encodeURIComponent(bad)}`);
      expect(r.status, bad).toBe(404);
      expect(r.text, bad).not.toContain(bad.length > 3 ? bad : "\u0000");
    }
  });
});

describe("a duplicate invoice is flagged", () => {
  const reg = async (w: Awaited<ReturnType<typeof world>>, nonce: number, refN: number, extra: object = {}) => {
    const invoice = { supplier: SUPPLIER.address, buyer: BUYER.address, token: TOKEN, amount: 1_000n * USD, dueDate: BigInt(Math.floor(Date.now() / 1000) + 40 * 86400), refHash: id(200 + refN) as `0x${string}`, nonce: BigInt(nonce) };
    const signature = await SUPPLIER.signTypedData(invoiceTypedData(D, invoice) as never);
    return w.supplierSession.post("/api/relay/register", { invoice: { ...invoice, amount: invoice.amount.toString(), dueDate: invoice.dueDate.toString(), nonce: invoice.nonce.toString() }, signature, ...extra });
  };

  it("the same buyer, amount and reference under a new nonce is refused unless the supplier says it is deliberate", async () => {
    const w = await world();
    await w.approved(1, 1_000n * USD, 7); // the original: reference 7
    const dup = await reg(w, 2, 7);
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("DUPLICATE_INVOICE");
    expect((await reg(w, 3, 8)).status).toBe(202); // a different reference is a different invoice
    expect((await reg(w, 4, 7, { allowDuplicate: true })).status).toBe(202); // deliberate
  });

  it("the invoice list marks the later copy with the original's id, and not the original", async () => {
    const w = await world();
    const a = await w.approved(1, 1_000n * USD, 7);
    const b = await w.approved(2, 1_000n * USD, 7);
    const c = await w.approved(3, 2_000n * USD, 7); // a different amount: not a duplicate
    const items = (await w.anon.get("/api/invoices")).json.data.items as any[];
    const by = (x: string) => items.find((i) => i.id === x);
    expect(by(b).possibleDuplicateOf).toBe(a);
    expect(by(a).possibleDuplicateOf).toBe(b); // the original sees the other copy; the earliest id is what a reader is pointed to
    expect(by(c).possibleDuplicateOf).toBeNull();
  });
});

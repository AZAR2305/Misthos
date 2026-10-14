/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { domain, invoiceTypedData } from "../src/shared";
import { browser, makeApp, onboard, wallet } from "./helpers";

const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const TOKEN = "0x3600000000000000000000000000000000000000" as const;
const BUYER = ("0x" + "b2".repeat(20)) as `0x${string}`;
const OTHER_BUYER = ("0x" + "c3".repeat(20)) as `0x${string}`;
const id = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(32);
const USD = 1_000_000n;

/** The chain is not needed to test the gate: the relayer and RPC client are stand-ins that say "not registered yet" and accept the job. */
const stubs = { relayer: {} as never, client: { readContract: async () => [0n, 0n, 0n, 0n, 0n, 0n, 0], verifyTypedData: async () => false } as never };

async function setup() {
  const made = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK }, ...stubs });
  const supplier = browser(made.app);
  await onboard(supplier, made.google, { sub: "s", email: "supplier@example.com", walletIndex: 1, side: "supplier" });
  const me = wallet(1);
  let log = 0;
  const ev = (tx: string, block: number, name: string, payload: object) => made.db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, $2, $3, $4, $5::jsonb)", [tx, log++, block, name, JSON.stringify(payload)]);
  /** An approved, unpaid invoice from this supplier to a buyer: what the buyer owes them. */
  const owed = async (n: number, buyer: string, amount: bigint) => {
    await ev("0x" + (0x10 + n).toString(16).repeat(32), 1, "InvoiceRegistered", { id: id(n), supplier: me.address.toLowerCase(), buyer, token: TOKEN, amount: amount.toString(), dueDate: String(Math.floor(Date.now() / 1000) + 30 * 86400), refHash: id(200 + n) });
    await ev("0x" + (0x30 + n).toString(16).repeat(32), 2, "InvoiceApproved", { id: id(n), approvedAt: "1700000000" });
  };
  const register = async (buyer: `0x${string}`, amount: bigint, nonce: number) => {
    const invoice = { supplier: me.address, buyer, token: TOKEN, amount, dueDate: BigInt(Math.floor(Date.now() / 1000) + 40 * 86400), refHash: id(250 + nonce) as `0x${string}`, nonce: BigInt(nonce) };
    const signature = await me.signTypedData(invoiceTypedData(D, invoice) as never);
    return supplier.post("/api/relay/register", { invoice: { ...invoice, amount: invoice.amount.toString(), dueDate: invoice.dueDate.toString(), nonce: invoice.nonce.toString() }, signature });
  };
  const limit = (n: bigint, max = n) => supplier.put("/api/exposure-policy", { newCounterpartyLimit: n.toString(), maxLimit: max.toString(), growthBps: 2000, lookbackDays: 180, graceSeconds: 86400 });
  return { ...made, supplier, owed, register, limit, ev };
}

describe("credit is enforced where it is extended: when an invoice is registered", () => {
  it("with no limit set, nothing is checked", async () => {
    const t = await setup();
    await t.owed(1, BUYER, 4_000n * USD);
    expect((await t.register(BUYER, 50_000n * USD, 1)).status).toBe(202);
  });

  it("an invoice that would take what this buyer owes past the supplier's limit is refused, with the reason", async () => {
    const t = await setup();
    await t.limit(5_000n * USD);
    await t.owed(1, BUYER, 4_000n * USD); // already owed
    const refused = await t.register(BUYER, 2_000n * USD, 1); // 4,000 + 2,000 > 5,000
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("EXPOSURE_LIMIT");
    expect(refused.json.error.message).toMatch(/exposure-1/);
    const fits = await t.register(BUYER, 1_000n * USD, 2); // 4,000 + 1,000 = 5,000, exactly at the limit
    expect(fits.status).toBe(202);
  });

  it("only this buyer's debt counts: another buyer is a separate relationship", async () => {
    const t = await setup();
    await t.limit(5_000n * USD);
    await t.owed(1, OTHER_BUYER, 4_900n * USD);
    expect((await t.register(BUYER, 4_000n * USD, 1)).status).toBe(202);
  });

  it("an invoice already paid is no longer owed, and settlements raise the limit", async () => {
    const t = await setup();
    await t.limit(1_000n * USD, 20_000n * USD); // starting limit 1,000, growth 20%, maximum 20,000
    await t.owed(1, BUYER, 10_000n * USD);
    await t.ev("0x" + "ee".repeat(32), 3, "SettledOnDue", { id: id(1), amount: (10_000n * USD).toString() });
    await t.db.query("insert into chain_blocks (block, time_sec) values (3, $1)", [Math.floor(Date.now() / 1000) - 86400]);
    // limit = 1,000 + 20% of 10,000 = 3,000; nothing outstanding
    expect((await t.register(BUYER, 3_000n * USD, 1)).status).toBe(202);
    expect((await t.register(BUYER, 3_001n * USD, 2)).status).toBe(409);
  });
});

describe("GET /api/payables: what a buyer owes on approved, unpaid invoices", () => {
  it("lists only approved, unpaid invoices for that buyer, from any supplier", async () => {
    const t = await setup();
    await t.owed(1, BUYER, 4_000n * USD);
    await t.owed(2, BUYER, 1_500n * USD);
    await t.owed(3, OTHER_BUYER, 9_000n * USD);
    await t.ev("0x" + "ef".repeat(32), 4, "SettledOnDue", { id: id(2), amount: (1_500n * USD).toString() });
    const res = await t.app.request(`/api/payables?buyer=${BUYER}`);
    const { data } = (await res.json()) as any;
    expect(data.payables).toEqual([{ invoiceId: id(1), face: (4_000n * USD).toString(), dueSec: expect.any(Number) }]);
  });
  it("a buyer who owes nothing gets an empty list, and bad input is refused", async () => {
    const t = await setup();
    expect(((await (await t.app.request(`/api/payables?buyer=${BUYER}`)).json()) as any).data.payables).toEqual([]);
    expect((await t.app.request("/api/payables?buyer=nope")).status).toBeGreaterThanOrEqual(400);
  });
});

describe("the relayer is not an open gas faucet", () => {
  it("one supplier address can ask for only so many registrations an hour, then it is told when to retry", async () => {
    const made = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, REGISTER_LIMIT_PER_HOUR: "3" }, ...stubs });
    const supplier = browser(made.app);
    await onboard(supplier, made.google, { sub: "s", email: "supplier@example.com", walletIndex: 1, side: "supplier" });
    const me = wallet(1);
    const reg = async (nonce: number) => {
      const invoice = { supplier: me.address, buyer: BUYER, token: TOKEN, amount: 1_000n * USD, dueDate: BigInt(Math.floor(Date.now() / 1000) + 40 * 86400), refHash: id(250 + nonce) as `0x${string}`, nonce: BigInt(nonce) };
      const signature = await me.signTypedData(invoiceTypedData(D, invoice) as never);
      return supplier.post("/api/relay/register", { invoice: { ...invoice, amount: invoice.amount.toString(), dueDate: invoice.dueDate.toString(), nonce: invoice.nonce.toString() }, signature });
    };
    for (const n of [1, 2, 3]) expect((await reg(n)).status).toBe(202);
    const over = await reg(4);
    expect(over.status).toBe(429);
    expect(over.json.error.code).toBe("REGISTER_LIMIT");
    expect(over.json.error.message).toMatch(/Try again in about \d+ minutes/);
  });

  it("a different address is not held back by someone else's use", async () => {
    const made = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, REGISTER_LIMIT_PER_HOUR: "1" }, ...stubs });
    const post = async (idx: number, nonce: number) => {
      const b = browser(made.app);
      await onboard(b, made.google, { sub: `s${idx}`, email: `s${idx}@example.com`, walletIndex: idx, side: "supplier" });
      const w = wallet(idx);
      const invoice = { supplier: w.address, buyer: BUYER, token: TOKEN, amount: 1_000n * USD, dueDate: BigInt(Math.floor(Date.now() / 1000) + 40 * 86400), refHash: id(250 + nonce) as `0x${string}`, nonce: BigInt(nonce) };
      const signature = await w.signTypedData(invoiceTypedData(D, invoice) as never);
      return { b, send: (n: number) => b.post("/api/relay/register", { invoice: { ...invoice, nonce: String(n), amount: invoice.amount.toString(), dueDate: invoice.dueDate.toString() }, signature }) };
    };
    const one = await post(1, 1);
    const two = await post(2, 1);
    expect((await one.send(1)).status).not.toBe(429);
    expect((await one.send(1)).status).toBe(429);
    expect((await two.send(1)).status).not.toBe(429);
  });
});

describe("the relayer's balance is reported before it runs dry", () => {
  const withBalance = (balance: bigint | Error) => ({ relayer: { address: ("0x" + "d4".repeat(20)) as `0x${string}` } as never, client: { getBlockNumber: async () => 1n, getBalance: async () => { if (balance instanceof Error) throw balance; return balance; } } as never });
  it("says low, with a warning, below the threshold and fine above it", async () => {
    const low = await makeApp({ ...withBalance(10_000_000_000_000_000n), env: { INVOICE_BOOK_ADDRESS: BOOK } }); // 0.01 USDC native
    const lowHealth = (await browser(low.app).get("/api/health")).json.data;
    expect(lowHealth.relayer).toMatchObject({ configured: true, balance: "10000000000000000", low: true });
    expect(lowHealth.relayer.warning).toMatch(/top it up/);
    const ok = await makeApp({ ...withBalance(500_000_000_000_000_000n), env: { INVOICE_BOOK_ADDRESS: BOOK } });
    expect((await browser(ok.app).get("/api/health")).json.data.relayer).toMatchObject({ low: false });
  });
  it("never invents a balance it could not read", async () => {
    const t = await makeApp({ ...withBalance(new Error("rpc down")), env: { INVOICE_BOOK_ADDRESS: BOOK } });
    expect((await browser(t.app).get("/api/health")).json.data.relayer).toMatchObject({ configured: true, balance: null, low: null });
  });
});

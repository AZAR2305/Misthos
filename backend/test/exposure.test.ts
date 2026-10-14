import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers";

const SUPPLIER = "0x" + "a1".repeat(20);
const BUYER = "0x" + "b2".repeat(20);
const OTHER_SUPPLIER = "0x" + "c3".repeat(20);
const TOKEN = "0x3600000000000000000000000000000000000000";
const id = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(32);
const tx = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(32);

async function seed() {
  const { app, db } = await makeApp();
  let log = 0;
  const ev = (txHash: string, block: number, name: string, payload: Record<string, unknown>) =>
    db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, $2, $3, $4, $5::jsonb)", [txHash, log++, block, name, JSON.stringify(payload)]);
  const invoice = async (n: number, supplier: string, amount: string, due: number) => {
    await ev(tx(100 + n), 1, "InvoiceRegistered", { id: id(n), supplier, buyer: BUYER, token: TOKEN, amount, dueDate: String(due), refHash: id(200 + n) });
    await ev(tx(120 + n), 2, "InvoiceApproved", { id: id(n), approvedAt: "1700000000" });
  };
  // 1: settled on its due date (block 10).   2: paid early (block 11).   3: approved, unpaid.   4: another supplier.   5: settled in a block with no indexed time.
  await invoice(1, SUPPLIER, "10000000000", 1_800_000_000);
  await ev(tx(1), 10, "SettledOnDue", { id: id(1), amount: "10000000000" });
  await invoice(2, SUPPLIER, "4000000000", 1_900_000_000);
  await ev(tx(2), 11, "EarlySettled", { id: id(2), net: "3800000000", discount: "200000000", rateBps: 600, fee: "20000000", decisionHash: id(250) });
  await invoice(3, SUPPLIER, "2000000000", 1_900_000_000);
  await invoice(4, OTHER_SUPPLIER, "7000000000", 1_900_000_000);
  await invoice(5, SUPPLIER, "1000000000", 1_800_000_000);
  await ev(tx(5), 12, "SettledOnDue", { id: id(5), amount: "1000000000" });
  await db.query("insert into chain_blocks (block, time_sec) values (10, 1790000000), (11, 1795000000)");
  return app;
}

const get = async (app: Awaited<ReturnType<typeof seed>>, qs: string) => app.request(`/api/exposure?${qs}`);

describe("GET /api/exposure", () => {
  it("returns the invoices between exactly these two businesses, each settlement with its transaction and log index", async () => {
    const app = await seed();
    const res = await get(app, `side=buyer&owner=${BUYER}&counterparty=${SUPPLIER}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { events: Array<Record<string, unknown>> } };
    const byId = new Map(data.events.map((e) => [e.invoiceId, e]));
    expect(byId.size).toBe(4); // invoices 1, 2, 3 and 5; invoice 4 belongs to another supplier
    expect(byId.has(id(4))).toBe(false);
    expect(byId.get(id(1))).toMatchObject({ state: "settled_on_due", face: "10000000000", settledAtSec: 1_790_000_000, txHash: tx(1) });
    expect(typeof byId.get(id(1))!.logIndex).toBe("number");
    expect(byId.get(id(2))).toMatchObject({ state: "settled_early", face: "4000000000", outflow: "3820000000", rateBps: 600, settledAtSec: 1_795_000_000, txHash: tx(2) });
    expect(byId.get(id(3))).toMatchObject({ state: "approved", face: "2000000000", dueSec: 1_900_000_000 });
    expect(byId.get(id(3))).not.toHaveProperty("txHash");
  });

  it("a settlement in a block whose time is not indexed carries no time, so it cannot be counted as verified", async () => {
    const app = await seed();
    const { data } = (await (await get(app, `side=buyer&owner=${BUYER}&counterparty=${SUPPLIER}`)).json()) as { data: { events: Array<Record<string, unknown>> } };
    const e = data.events.find((x) => x.invoiceId === id(5))!;
    expect(e.state).toBe("settled_on_due");
    expect(e.settledAtSec).toBeUndefined();
  });

  it("is the same data from the supplier's side, and empty for a pair that has never traded", async () => {
    const app = await seed();
    const s = (await (await get(app, `side=supplier&owner=${SUPPLIER}&counterparty=${BUYER}`)).json()) as { data: { events: unknown[] } };
    expect(s.data.events).toHaveLength(4);
    const none = (await (await get(app, `side=buyer&owner=${BUYER}&counterparty=${"0x" + "d4".repeat(20)}`)).json()) as { data: { events: unknown[] } };
    expect(none.data.events).toEqual([]);
  });

  it("an invoice that was only registered creates no exposure", async () => {
    const { app, db } = await makeApp();
    await db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, 0, 1, 'InvoiceRegistered', $2::jsonb)", [tx(1), JSON.stringify({ id: id(1), supplier: SUPPLIER, buyer: BUYER, token: TOKEN, amount: "5", dueDate: "1900000000", refHash: id(9) })]);
    const { data } = (await (await app.request(`/api/exposure?side=buyer&owner=${BUYER}&counterparty=${SUPPLIER}`)).json()) as { data: { events: unknown[] } };
    expect(data.events).toEqual([]);
  });

  it("rejects bad input", async () => {
    const app = await seed();
    expect((await get(app, `side=other&owner=${BUYER}&counterparty=${SUPPLIER}`)).status).toBeGreaterThanOrEqual(400);
    expect((await get(app, `side=buyer&owner=nope&counterparty=${SUPPLIER}`)).status).toBeGreaterThanOrEqual(400);
    expect((await get(app, `side=buyer`)).status).toBeGreaterThanOrEqual(400);
  });
});

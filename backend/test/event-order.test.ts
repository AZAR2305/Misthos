import { describe, expect, it } from "vitest";
import { loadInvoices } from "../src/indexer";
import { browser, makeApp } from "./helpers";

const TOKEN = "0x3600000000000000000000000000000000000000";
const ID = "0x" + "ab".repeat(32);

describe("events are replayed in chain order, however many digits the block number has", () => {
  it("block 9 comes before block 10, 99 before 100: the order is numeric, not alphabetical", async () => {
    const { app, db } = await makeApp();
    const ev = (tx: string, block: number, name: string, payload: object) =>
      db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, 0, $2, $3, $4::jsonb)", [tx, block, name, JSON.stringify(payload)]);
    await ev("0x" + "01".repeat(32), 9, "InvoiceRegistered", { id: ID, supplier: "0x" + "11".repeat(20), buyer: "0x" + "22".repeat(20), token: TOKEN, amount: "1000000", dueDate: "1900000000", refHash: "0x" + "00".repeat(32) });
    await ev("0x" + "02".repeat(32), 10, "InvoiceApproved", { id: ID, approvedAt: "1800000000" });
    await ev("0x" + "03".repeat(32), 100, "EarlySettled", { id: ID, net: "1000000", discount: "0", rateBps: 0, fee: "0", decisionHash: "0x" + "00".repeat(32) });
    expect((await loadInvoices(db))[0]).toMatchObject({ id: ID, status: "settled_early" });
    const detail = (await browser(app).get(`/api/invoices/${ID}`)).json.data;
    expect(detail.events.map((e: { name: string }) => e.name)).toEqual(["InvoiceRegistered", "InvoiceApproved", "EarlySettled"]);
  });
});

describe("stats are split by where the activity comes from, and never added together", () => {
  it("a team wallet is team, an undocumented wallet is unverified, and the default view (independent pilots) holds neither", async () => {
    const { REGISTRY } = await import("../src/shared");
    const teamWallet = REGISTRY.team[0]!.address;
    const { app, db } = await makeApp();
    const ev = (tx: string, block: number, name: string, payload: object) =>
      db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, 0, $2, $3, $4::jsonb)", [tx, block, name, JSON.stringify(payload)]);
    const settle = async (n: number, supplier: string, buyer: string) => {
      const iid = "0x" + n.toString(16).padStart(2, "0").repeat(32);
      await ev("0x" + (0x10 + n).toString(16).repeat(32), n * 10 + 1, "InvoiceRegistered", { id: iid, supplier, buyer, token: TOKEN, amount: "1000000", dueDate: "1900000000", refHash: "0x" + "00".repeat(32) });
      await ev("0x" + (0x30 + n).toString(16).repeat(32), n * 10 + 2, "InvoiceApproved", { id: iid, approvedAt: "1800000000" });
      await ev("0x" + (0x50 + n).toString(16).repeat(32), n * 10 + 3, "EarlySettled", { id: iid, net: "1000000", discount: "0", rateBps: 0, fee: "0", decisionHash: "0x" + "00".repeat(32) });
      await db.query("insert into chain_blocks (block, time_sec) values ($1, $2)", [n * 10 + 3, 1_800_000_000]);
    };
    await settle(1, teamWallet, "0x" + "22".repeat(20)); // we are on one side
    await settle(2, "0x" + "33".repeat(20), "0x" + "44".repeat(20)); // nobody has documented either
    const get = async (q = "") => (await browser(app).get(`/api/stats${q}`)).json.data;
    expect(await get()).toMatchObject({ source: "pilot", counts: { pilot: 0, team: 1, unverified: 1 } });
    expect((await get()).summary.count).toBe(0); // no independent pilot yet, so nothing counts
    expect((await get("?source=team")).summary.count).toBe(1);
    expect((await get("?source=unverified")).summary.count).toBe(1);
    expect((await browser(app).get("/api/stats?source=everything")).status).toBe(400); // there is no way to ask for a mixed total
  });
});

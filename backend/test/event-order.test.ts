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

import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "../src/lib/chain/invoices";
import { trustFacts } from "../src/lib/chain/trust";

const h = (n: number) => ("0x" + n.toString(16).padStart(2, "0").repeat(32)) as `0x${string}`;
const a = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as `0x${string}`;
const make = (n: number, o: Partial<InvoiceRecord> = {}): InvoiceRecord => ({ id: h(n), supplier: a(1), buyer: a(2), token: a(9), amount: 1_000_000n * BigInt(n), dueDate: 2_000_000_000n, refHash: h(100 + n), status: "approved", registered: { tx: h(200 + n), block: BigInt(n) }, ...o });
const paid = (n: number, kind: "early" | "due", o: Partial<InvoiceRecord> = {}) =>
  make(n, { status: kind === "early" ? "settled_early" : "settled_due", settled: { kind, tx: h(50 + n), block: BigInt(n), logIndex: 0, net: 1n, discount: 0n, rateBps: 0, fee: 0n }, ...o });

describe("trust facts are counts from the contract log, for this pair only", () => {
  it("a first invoice between two parties is flagged as first, with nothing counted", () => {
    const inv = make(1);
    expect(trustFacts([inv], inv)).toMatchObject({ pairSettled: 0, firstTimePair: true, pairVolume: 0n, pairDisputed: 0 });
  });
  it("counts only settled invoices between exactly this supplier and buyer, and never the invoice itself", () => {
    const inv = make(9);
    const all = [paid(1, "early"), paid(2, "due"), paid(3, "early", { buyer: a(7) }), paid(4, "early", { supplier: a(8) }), make(5, { status: "disputed" }), inv];
    expect(trustFacts(all, inv)).toMatchObject({ pairSettled: 2, pairSettledEarly: 1, pairDisputed: 1, firstTimePair: false, pairVolume: 3_000_000n });
  });
  it("flags both invoices when the same supplier, buyer, amount and reference appear twice", () => {
    const first = make(1, { refHash: h(77), amount: 5n });
    const second = make(2, { refHash: h(77), amount: 5n });
    expect(trustFacts([first, second], second).duplicateOf).toBe(first.id); // the earliest other one
    expect(trustFacts([first, second], first).duplicateOf).toBe(second.id); // flagged both ways, for a person to look at
  });
});

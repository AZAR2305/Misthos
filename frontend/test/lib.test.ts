import { describe, expect, it } from "vitest";
import { balanced, journalFor, journalFrom, toBeancount, toCsv } from "../src/lib/accounting";
import { buildInvoices, type RawLog } from "../src/lib/chain/invoices";
import { decodeOfferCode, encodeOfferCode, offerCodeSchema, randomNonce, type OfferCode } from "../src/lib/offers";
import { headline, settlementRows, summarise } from "../src/lib/stats";

// CLAUDE.md Appendix B: $2,000, 1000 bps, 27 days early.
const SUPPLIER = "0x00000000000000000000000000000000000000a1";
const BUYER = "0x00000000000000000000000000000000000000b2";
const ID = ("0x" + "ab".repeat(32)) as `0x${string}`;
const DUE = 1_802_332_800n; // unix seconds
const PAID = Number(DUE) - 27 * 86_400;

const tx = (c: string) => ("0x" + c.repeat(64)) as `0x${string}`;
const logs: RawLog[] = [
  { eventName: "InvoiceRegistered", args: { id: ID, supplier: SUPPLIER, buyer: BUYER, token: "0x3600000000000000000000000000000000000000", amount: 2_000_000_000n, dueDate: DUE, refHash: tx("c") }, transactionHash: tx("1"), blockNumber: 10n, logIndex: 0 },
  { eventName: "InvoiceApproved", args: { id: ID, approvedAt: 1_799_000_000n }, transactionHash: tx("2"), blockNumber: 11n, logIndex: 0 },
  { eventName: "EarlySettled", args: { id: ID, net: 1_985_205_480n, discount: 14_794_520n, rateBps: 1000, fee: 1_479_452n, decisionHash: tx("d") }, transactionHash: tx("3"), blockNumber: 12n, logIndex: 0 },
];
const time = (b: bigint) => (b === 12n ? PAID : undefined);

describe("buildInvoices", () => {
  it("folds events into one record with its lifecycle", () => {
    const [inv] = buildInvoices(logs);
    expect(inv).toMatchObject({ id: ID, status: "settled_early", amount: 2_000_000_000n, supplier: SUPPLIER, buyer: BUYER });
    expect(inv!.approved?.block).toBe(11n);
    expect(inv!.settled).toMatchObject({ kind: "early", net: 1_985_205_480n, discount: 14_794_520n, rateBps: 1000, fee: 1_479_452n });
  });

  it("orders by block and log index regardless of input order, and ignores events for unknown invoices", () => {
    const shuffled = [logs[2]!, logs[0]!, logs[1]!, { ...logs[1]!, args: { id: "0x" + "ee".repeat(32), approvedAt: 1n } }];
    const out = buildInvoices(shuffled);
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe("settled_early");
  });

  it("tracks disputes and on-due settlement", () => {
    const disputed = buildInvoices([logs[0]!, { eventName: "InvoiceDisputed", args: { id: ID }, transactionHash: tx("4"), blockNumber: 11n, logIndex: 0 }]);
    expect(disputed[0]!.status).toBe("disputed");
    const onDue = buildInvoices([logs[0]!, logs[1]!, { eventName: "SettledOnDue", args: { id: ID, amount: 2_000_000_000n }, transactionHash: tx("5"), blockNumber: 13n, logIndex: 0 }]);
    expect(onDue[0]).toMatchObject({ status: "settled_due", settled: { kind: "due", net: 2_000_000_000n, discount: 0n } });
  });
});

describe("accounting", () => {
  const [inv] = buildInvoices(logs);

  it("journals balance on both sides, including the success fee", () => {
    const buyer = journalFor("buyer", inv!);
    const supplier = journalFor("supplier", inv!);
    expect(balanced(buyer)).toBe(true);
    expect(balanced(supplier)).toBe(true);
    expect(buyer.find((l) => l.account === "Cash (USDC)")!.credit).toBe(1_985_205_480n + 1_479_452n);
    expect(supplier.find((l) => l.account === "Cash (USDC)")!.debit).toBe(1_985_205_480n);
    expect(supplier.find((l) => l.account === "Accounts receivable")!.credit).toBe(2_000_000_000n);
  });

  it("a zero-rate settlement has no discount or fee lines", () => {
    const zero = { ...inv!, settled: { ...inv!.settled!, discount: 0n, fee: 0n, net: 2_000_000_000n, rateBps: 0 } };
    const lines = journalFor("buyer", zero);
    expect(lines.map((l) => l.account)).toEqual(["Accounts payable", "Cash (USDC)"]);
    expect(balanced(lines)).toBe(true);
  });

  it("selects by wallet and exports CSV and balanced beancount", () => {
    const lines = journalFrom("buyer", [inv!], BUYER.toUpperCase());
    expect(lines.length).toBeGreaterThan(0);
    expect(journalFrom("buyer", [inv!], SUPPLIER)).toEqual([]);
    const csv = toCsv(lines, time);
    expect(csv.split("\n")[0]).toBe("date,invoice,account,debit,credit,memo,tx");
    expect(csv).toContain("1986.684932"); // net 1985.205480 + fee 1.479452
    const bean = toBeancount(lines, time);
    expect(bean).toContain('option "operating_currency" "USDC"');
    // every posting line sums to zero (beancount requires balanced transactions)
    const sum = bean
      .split("\n")
      .filter((l) => /^\s+(Assets|Liabilities|Income|Expenses):/.test(l))
      .reduce((acc, l) => acc + BigInt(l.trim().split(/\s+/)[1]!.replace(".", "")), 0n);
    expect(sum).toBe(0n);
  });
});

describe("stats", () => {
  const [inv] = buildInvoices(logs);
  it("derives the Appendix B numbers from chain events", () => {
    const rows = settlementRows([inv!], time);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ daysEarly: 27, discount: 14_794_520n, aprBps: 1007n });
    const s = summarise(rows);
    expect(s).toMatchObject({ count: 1, medianDaysEarly: 27, zeroSharePct: 0, weightedAprBps: 1007n });
    expect(headline(s)).toBe("1 invoice was paid a median 27 days early, moving $1,985.21 in USDC. Buyers earned 10.1% annualised.");
  });
  it("says so plainly when nothing has settled", () => {
    expect(headline(summarise([]))).toBe("No invoice has been paid early on this network yet.");
  });
  it("reports the share that cleared at 0%", () => {
    const zero = { ...inv!, settled: { ...inv!.settled!, rateBps: 0, discount: 0n } };
    const s = summarise(settlementRows([zero], time));
    expect(s.zeroSharePct).toBe(100);
    expect(headline(s)).toContain("100% cleared at 0%");
  });
});

describe("offer codes", () => {
  const code: OfferCode = {
    v: 1,
    chainId: 5042002,
    book: "0x00000000000000000000000000000000000000aa",
    supplier: SUPPLIER,
    offer: { invoiceId: ID, rateBps: 1000, expiry: "1800000900", nonce: randomNonce().toString() },
    sig: "0x" + "cd".repeat(65),
  };
  it("round-trips", () => {
    const text = encodeOfferCode(code);
    expect(text.startsWith("misthos-offer-1:")).toBe(true);
    expect(decodeOfferCode(text)).toEqual({ ok: true, value: code });
    expect(decodeOfferCode("  " + text + "\n")).toEqual({ ok: true, value: code });
  });
  it("rejects garbage, wrong prefixes, truncation and unknown fields without throwing", () => {
    for (const bad of ["", "hello", "misthos-offer-1:", "misthos-offer-1:@@@", encodeOfferCode(code).slice(0, -10)]) {
      expect(decodeOfferCode(bad).ok).toBe(false);
    }
    expect(offerCodeSchema.safeParse({ ...code, note: "settle at 50%" }).success).toBe(false);
    expect(offerCodeSchema.safeParse({ ...code, offer: { ...code.offer, rateBps: 5001 } }).success).toBe(false);
  });
  it("nonces are 128-bit and unique", () => {
    const a = randomNonce();
    expect(a).not.toBe(randomNonce());
    expect(a < 2n ** 128n).toBe(true);
  });
});

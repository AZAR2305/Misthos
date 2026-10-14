import { describe, expect, it } from "vitest";
import {
  SHADOW_LABEL,
  parseDateSec,
  parseInvoicesCsv,
  parseObligationsCsv,
  shadowReport,
  shadowToCsv,
  shadowToMarkdown,
  type BuyerPolicy,
} from "../src/core/index";

const USD = 1_000_000n;
const DAY = 86_400n;
const NOW = BigInt(Date.UTC(2027, 0, 15) / 1000); // a UTC midnight, so whole-day due dates are exact
const day = (n: number) => new Date(Number(NOW + BigInt(n) * DAY) * 1000).toISOString().slice(0, 10);
const policy = (over: Partial<BuyerPolicy> = {}): BuyerPolicy => ({ hurdleAprBps: 0, liquidityFloor: 5_000n * USD, perInvoiceCap: 0n, dailyCap: 0n, humanAbove: 0n, feeBps: 0, ...over });
const HEADER = "counterparty,amount,due_date,approved_date,offer_rate_pct";

/** The golden fixture from CLAUDE.md Appendix B: invoices A, B, C, D with their own posted rates. */
const APPENDIX_B = [HEADER, `Alpha,2000,${day(27)},${day(-1)},10`, `Bravo,3500,${day(20)},${day(-1)},14`, `Charlie,1200,${day(10)},${day(-1)},9`, `Delta,4000,${day(25)},${day(-1)},12`].join("\n");

describe("shadow report on the Appendix B fixtures", () => {
  it("finds the same best set as the agent's allocator: A and D, 47_671_232, against greedy's 44_602_739", () => {
    const { rows, errors } = parseInvoicesCsv(APPENDIX_B, NOW);
    expect(errors).toEqual([]);
    const r = shadowReport({ nowSec: NOW, cash: 12_000n * USD, policy: policy(), invoices: rows, obligations: [], includeUnselectedDue: false });
    expect(r.best.ids).toEqual([2, 5]); // lines 2 and 5 are A and D (line 1 is the header)
    expect(r.best.totalDiscount).toBe(47_671_232n);
    expect(r.best.greedyIds).toEqual([3, 2, 4]); // B, A, C
    expect(r.best.greedyDiscount).toBe(44_602_739n);
  });

  it("is labelled shadow, everywhere", () => {
    const { rows } = parseInvoicesCsv(APPENDIX_B, NOW);
    const r = shadowReport({ nowSec: NOW, cash: 12_000n * USD, policy: policy(), invoices: rows, obligations: [] });
    expect(r.source).toBe("shadow");
    expect(r.label).toBe("Shadow report: computation on your data. No funds moved.");
    expect(SHADOW_LABEL).toBe(r.label);
    expect(shadowToCsv(r).startsWith(`# ${SHADOW_LABEL}`)).toBe(true);
    expect(shadowToMarkdown(r).startsWith(`**${SHADOW_LABEL}**`)).toBe(true);
  });
});

describe("the arrival-order decisions use the agent's own per-offer rules", () => {
  it("pays what fits the cash path and holds what would breach the floor, with the agent's reason", () => {
    // Cash 8,000 with a 5,000 floor leaves 3,000 of room. Delta (4,000) cannot fit; Charlie (1,200) and Alpha (2,000) cannot both.
    const { rows } = parseInvoicesCsv(APPENDIX_B, NOW);
    const r = shadowReport({ nowSec: NOW, cash: 8_000n * USD, policy: policy(), invoices: rows, obligations: [], includeUnselectedDue: false });
    const by = (name: string) => r.lines.find((l) => l.counterparty === name)!;
    expect(by("Delta").decision).toBe("hold");
    expect(by("Delta").reasonCode).toBe("LIQUIDITY_FLOOR");
    expect(by("Delta").reason).toMatch(/cash/i);
    const paid = r.lines.filter((l) => l.decision === "accelerate");
    expect(paid.length).toBeGreaterThan(0);
    // what was paid never took cash under the floor: total outflow is within the room
    expect(r.totals.outflow <= 3_000n * USD).toBe(true);
  });

  it("a payroll obligation that falls before the due dates makes a set infeasible", () => {
    const { rows } = parseInvoicesCsv(APPENDIX_B, NOW);
    const none = shadowReport({ nowSec: NOW, cash: 12_000n * USD, policy: policy(), invoices: rows, obligations: [], includeUnselectedDue: false });
    const payroll = parseObligationsCsv(`label,amount,due_date\nPayroll,5000,${day(3)}`);
    expect(payroll.errors).toEqual([]);
    const withPayroll = shadowReport({ nowSec: NOW, cash: 12_000n * USD, policy: policy(), invoices: rows, obligations: payroll.rows, includeUnselectedDue: false });
    expect(withPayroll.totals.outflow < none.totals.outflow).toBe(true); // 5,000 of the 7,000 spare cash is spoken for, so far less can be paid early
    expect(withPayroll.totals.held).toBeGreaterThan(none.totals.held);
    expect(withPayroll.best.totalDiscount < none.best.totalDiscount).toBe(true);
    // and a payroll larger than the spare cash blocks everything
    const big = parseObligationsCsv(`label,amount,due_date\nPayroll,7500,${day(3)}`);
    const blocked = shadowReport({ nowSec: NOW, cash: 12_000n * USD, policy: policy(), invoices: rows, obligations: big.rows, includeUnselectedDue: false });
    expect(blocked.totals.accelerated).toBe(0);
    expect(blocked.lines.every((l) => l.reasonCode === "LIQUIDITY_FLOOR")).toBe(true);
  });

  it("the zero-rate case: with a zero hurdle and no offer rate, every invoice that fits is paid early at no cost to the supplier", () => {
    const csv = [HEADER.replace(",offer_rate_pct", ""), `Acme,2500,${day(30)},${day(-2)}`, `Birch,1500,${day(20)},${day(-1)}`].join("\n");
    const { rows, errors } = parseInvoicesCsv(csv, NOW);
    expect(errors).toEqual([]);
    const r = shadowReport({ nowSec: NOW, cash: 20_000n * USD, policy: policy({ hurdleAprBps: 0, liquidityFloor: 1_000n * USD }), invoices: rows, obligations: [] });
    expect(r.totals.accelerated).toBe(2);
    expect(r.lines.every((l) => l.rateBps === 0 && l.discount === 0n && l.fee === 0n && l.net === l.face)).toBe(true);
    // the supplier is paid early for nothing; factoring over the same days would have cost something
    expect(r.totals.factoringCost > 0n).toBe(true);
    expect(r.totals.supplierKeepsVsFactoring).toBe(r.totals.factoringCost);
    expect(r.assumptions.join(" ")).toContain("your hurdle (0.00% a year)");
    // the optimiser finds no discount to chase at 0%, and the report says so rather than calling it a "no"
    expect(r.best.totalDiscount).toBe(0n);
  });

  it("a hurdle above the offered rate holds the invoice with BELOW_HURDLE, and an unapproved one is not eligible", () => {
    const csv = [HEADER, `Acme,2500,${day(30)},${day(-2)},3`, `Birch,1500,${day(20)},,10`].join("\n");
    const { rows } = parseInvoicesCsv(csv, NOW);
    const r = shadowReport({ nowSec: NOW, cash: 20_000n * USD, policy: policy({ hurdleAprBps: 800 }), invoices: rows, obligations: [] });
    expect(r.lines[0]).toMatchObject({ decision: "hold", reasonCode: "BELOW_HURDLE" });
    expect(r.lines[1]).toMatchObject({ decision: "hold", reasonCode: "NOT_ELIGIBLE" });
    expect(JSON.stringify(r.lines, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("800"); // it never states the hurdle
  });
});

describe("malformed input is rejected by line, never guessed at", () => {
  it("names the row and the problem", () => {
    const bad = [HEADER, `Acme,2500,${day(30)},${day(-1)},4`, `Birch,12.3456789,${day(30)},${day(-1)},4`, `Cobalt,100,2026-13-45,${day(-1)},4`, `Dune,100,${day(30)},not-a-date,4`, `Echo,100,${day(30)},${day(-1)},77`, `,100,${day(30)},${day(-1)},4`, `Fern,100,${day(30)}`].join("\n");
    const { rows, errors } = parseInvoicesCsv(bad, NOW);
    expect(rows).toEqual([]); // nothing is computed from a file with a bad row
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(errors[0]!.message).toMatch(/Not a USDC amount/);
    expect(errors[1]!.message).toMatch(/due_date .* is not a real date/);
    expect(errors[2]!.message).toMatch(/approved_date/);
    expect(errors[3]!.message).toMatch(/offer_rate_pct/);
    expect(errors[4]!.message).toMatch(/counterparty is empty/);
    expect(errors[5]!.message).toMatch(/values but the header has/);
  });

  it("rejects an unknown or missing column, an unclosed quote, a missing header, and more than 20 invoices", () => {
    expect(parseInvoicesCsv("counterparty,amount,due_date,approved_date,bank_account\nA,1,2027-02-01,", NOW).errors[0]!.message).toMatch(/Unknown column "bank_account"/);
    expect(parseInvoicesCsv("counterparty,amount\nA,1", NOW).errors.map((e) => e.message).join(" ")).toMatch(/Missing column "due_date"/);
    expect(parseInvoicesCsv(`${HEADER}\n"Acme,2500,${day(5)},${day(-1)},1`, NOW).errors[0]!.message).toMatch(/not closed/);
    expect(parseInvoicesCsv("", NOW).errors[0]!.message).toMatch(/No header/);
    const many = [HEADER, ...Array.from({ length: 21 }, (_, i) => `S${i},100,${day(10 + i)},${day(-1)},2`)].join("\n");
    expect(parseInvoicesCsv(many, NOW).errors[0]!.message).toMatch(/At most 20 invoices/);
  });

  it("only real calendar dates pass", () => {
    expect(parseDateSec("2027-02-29")).toBeUndefined();
    expect(parseDateSec("2028-02-29")).toBeDefined();
    expect(parseDateSec("2027-1-5")).toBeUndefined();
  });

  it("quoted commas work, and control characters in a label are neutralised", () => {
    const { rows, errors } = parseInvoicesCsv(`${HEADER}\n"Acme, Inc",100,${day(30)},${day(-1)},4`, NOW);
    expect(errors).toEqual([]);
    expect(rows[0]!.counterparty).toBe("Acme, Inc");
    expect(parseInvoicesCsv(`${HEADER}\n"A\u0007B",100,${day(30)},${day(-1)},4`, NOW).rows[0]!.counterparty).toBe("A B");
  });
});

describe("the export", () => {
  it("neutralises a label that would run as a spreadsheet formula, and never contains the hurdle or cash", () => {
    const { rows } = parseInvoicesCsv(`${HEADER}\n"=HYPERLINK(""http://evil"")",1000,${day(30)},${day(-1)},4`, NOW);
    const r = shadowReport({ nowSec: NOW, cash: 31_337n * USD, policy: policy({ hurdleAprBps: 100, liquidityFloor: 4_242n * USD }), invoices: rows, obligations: [] });
    const csv = shadowToCsv(r);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/31337|4242/);
    expect(shadowToMarkdown(r)).not.toMatch(/31337|4242|31,337/);
  });
});

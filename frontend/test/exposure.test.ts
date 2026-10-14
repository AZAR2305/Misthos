import { describe, expect, it } from "vitest";
import { parseEvents, parsePolicy } from "../src/lib/exposure";

describe("policy reply", () => {
  const good = { side: "buyer", configured: true, version: "exposure-2", newCounterpartyLimit: "5000000000", maxLimit: "20000000000", growthBps: 2000, lookbackDays: 180, graceSeconds: 86400 };
  it("becomes integer limits", () => {
    expect(parsePolicy(good)).toEqual({ version: "exposure-2", newCounterpartyLimit: 5_000_000_000n, maxLimit: 20_000_000_000n, growthBps: 2000, lookbackDays: 180, graceSeconds: 86400 });
  });
  it("not configured is null: no limit set, never a default", () => {
    expect(parsePolicy({ side: "buyer", configured: false })).toBeNull();
  });
  it("anything unexpected is undefined, so the page says unavailable", () => {
    expect(parsePolicy(undefined)).toBeUndefined();
    expect(parsePolicy({ configured: "yes" })).toBeUndefined();
    expect(parsePolicy({ ...good, newCounterpartyLimit: "-5" })).toBeUndefined();
    expect(parsePolicy({ ...good, maxLimit: 5 })).toBeUndefined();
    expect(parsePolicy({ ...good, growthBps: 1.5 })).toBeUndefined();
    expect(parsePolicy({ ...good, lookbackDays: "180" })).toBeUndefined();
  });
});

describe("history reply", () => {
  const row = { invoiceId: "0xaa", state: "settled_early", face: "4000000000", outflow: "3900000000", dueSec: 1_900_000_000, settledAtSec: 1_795_000_000, txHash: "0xtx", logIndex: 2 };
  it("becomes bigint events with the proof fields kept", () => {
    expect(parseEvents([row, { invoiceId: "0xbb", state: "approved", face: "1", dueSec: 5 }])).toEqual([
      { invoiceId: "0xaa", state: "settled_early", face: 4_000_000_000n, outflow: 3_900_000_000n, dueSec: 1_900_000_000n, settledAtSec: 1_795_000_000n, txHash: "0xtx", logIndex: 2 },
      { invoiceId: "0xbb", state: "approved", face: 1n, dueSec: 5n },
    ]);
  });
  it("an empty history is an empty list", () => {
    expect(parseEvents([])).toEqual([]);
  });
  it("one malformed row makes the whole answer unavailable rather than quietly dropping it", () => {
    expect(parseEvents([row, { ...row, state: "registered" }])).toBeUndefined();
    expect(parseEvents([{ ...row, face: "-1" }])).toBeUndefined();
    expect(parseEvents([{ ...row, outflow: 5 }])).toBeUndefined();
    expect(parseEvents("nope")).toBeUndefined();
    expect(parseEvents([null])).toBeUndefined();
  });
});

import { parseObligations } from "../src/lib/obligations-parse";

describe("obligations reply", () => {
  it("becomes the rows the page uses, with a unix due time", () => {
    expect(parseObligations([{ id: "a", label: "Payroll", amount: "12000000000", dueDate: "2026-11-01T00:00:00.000Z", kind: "payroll" }])).toEqual([
      { id: "a", label: "Payroll", amount: "12000000000", dueSec: String(Date.parse("2026-11-01T00:00:00.000Z") / 1000), kind: "payroll" },
    ]);
    expect(parseObligations([])).toEqual([]);
  });
  it("a malformed row makes the whole list unavailable, so a missing payment can never be dropped silently", () => {
    expect(parseObligations([{ id: "a", label: "x", amount: "-1", dueDate: "2026-11-01T00:00:00.000Z", kind: "bill" }])).toBeUndefined();
    expect(parseObligations([{ id: "a", label: "x", amount: "1", dueDate: "not a date", kind: "bill" }])).toBeUndefined();
    expect(parseObligations([{ id: "a", label: "x", amount: "1", dueDate: "2026-11-01T00:00:00.000Z", kind: "rent" }])).toBeUndefined();
    expect(parseObligations(null)).toBeUndefined();
  });
});

import { bpsToPercent, percentToBps } from "../src/lib/exposure";

describe("growth percentage", () => {
  it("converts to basis points exactly and back", () => {
    expect(percentToBps("20")).toBe(2000);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("0.05")).toBe(5);
    expect(percentToBps("100")).toBe(10_000);
    expect(bpsToPercent(2000)).toBe("20");
    expect(bpsToPercent(1250)).toBe("12.5");
    expect(bpsToPercent(5)).toBe("0.05");
  });
  it("refuses anything else", () => {
    for (const bad of ["", "-1", "100.01", "101", "1e2", "1.234", "abc", "1,5"]) expect(percentToBps(bad), bad).toBeUndefined();
  });
});

import { newExposureFor } from "../src/lib/exposure";

describe("the commitment tested against the limit for one invoice", () => {
  const ev = (id: string, state: "approved" | "disputed" | "settled_early") => ({ invoiceId: id, state, face: 5n, dueSec: 9n });
  it("a supplier's approved or disputed invoice is already outstanding, so it is not a second commitment", () => {
    expect(newExposureFor("supplier", "0xAA", 100n, [ev("0xaa", "approved")])).toBe(0n);
    expect(newExposureFor("supplier", "0xaa", 100n, [ev("0xaa", "disputed")])).toBe(0n);
  });
  it("a supplier's invoice that is not outstanding yet counts at its face", () => {
    expect(newExposureFor("supplier", "0xaa", 100n, [])).toBe(100n);
    expect(newExposureFor("supplier", "0xaa", 100n, [ev("0xbb", "approved")])).toBe(100n);
  });
  it("a buyer's worst case is the full price", () => {
    expect(newExposureFor("buyer", "0xaa", 100n, [ev("0xaa", "approved")])).toBe(100n);
  });
});

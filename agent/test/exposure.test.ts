import { describe, expect, it } from "vitest";
import { allowedLimit, DEFAULT_EXPOSURE_POLICY, evaluateExposure, type ExposurePolicy, type InvoiceEvent } from "../src/core/index.js";

const USD = 1_000_000n;
const DAY = 86_400n;
const NOW = 1_800_000_000n;
const policy: ExposurePolicy = { version: "exposure-1", newCounterpartyLimit: 5_000n * USD, maxLimit: 20_000n * USD, growthBps: 2000, lookbackDays: 180, graceSeconds: 86_400 };

const settledOnDue = (id: string, face: bigint, ago: bigint, o: Partial<InvoiceEvent> = {}): InvoiceEvent => ({
  invoiceId: id, state: "settled_on_due", face, dueSec: NOW - ago, settledAtSec: NOW - ago, txHash: `0x${id}`, logIndex: 1, ...o,
});
const settledEarly = (id: string, face: bigint, outflow: bigint, dueIn: bigint, o: Partial<InvoiceEvent> = {}): InvoiceEvent => ({
  invoiceId: id, state: "settled_early", face, outflow, dueSec: NOW + dueIn, settledAtSec: NOW - 5n * DAY, txHash: `0x${id}`, logIndex: 2, ...o,
});
const approved = (id: string, face: bigint, dueIn: bigint): InvoiceEvent => ({ invoiceId: id, state: "approved", face, dueSec: NOW + dueIn });

const decide = (events: readonly InvoiceEvent[] | null, newExposure: bigint, side: "buyer" | "supplier" = "buyer", p = policy) => {
  const d = evaluateExposure({ side, nowSec: NOW, newExposure, events, policy: p });
  if (d.kind !== "decided") throw new Error("expected a decision");
  return d;
};

// SRS spec B.5: invoice 1 face 10,000 settled on its due date; invoice 2 face 4,000 paid early for 3,900, due in 20 days.
const history = [settledOnDue("a1", 10_000n * USD, 10n * DAY), settledEarly("b2", 4_000n * USD, 3_900n * USD, 20n * DAY)];

describe("buyer side: money paid ahead of terms to one supplier (worked example)", () => {
  it("C_allowed = min(20,000, 5,000 + 20% of 14,000) = 7,800 and 3,900 is outstanding", () => {
    const d = decide(history, 0n);
    expect(d).toMatchObject({ allowed: 7_800n * USD, outstanding: 3_900n * USD, settledVolume: 14_000n * USD, room: 3_900n * USD });
  });
  it("3,800 more fits (7,700 <= 7,800)", () => {
    expect(decide(history, 3_800n * USD)).toMatchObject({ ok: true });
  });
  it("4,000 more is rejected with EXPOSURE_LIMIT even though the wallet may hold plenty of USDC", () => {
    expect(decide(history, 4_000n * USD)).toMatchObject({ ok: false, reasonCode: "EXPOSURE_LIMIT" });
  });
  it("exactly at the limit is allowed, one minor unit over is not", () => {
    expect(decide(history, 3_900n * USD).ok).toBe(true);
    expect(decide(history, 3_900n * USD + 1n).ok).toBe(false);
  });
  it("lists the evidence with transaction and log index", () => {
    const d = decide(history, 0n);
    expect(d.evidence).toContainEqual({ ref: "a1", kind: "settlement", amount: 10_000n * USD, txHash: "0xa1", logIndex: 1 });
    expect(d.evidence).toContainEqual({ ref: "b2", kind: "outstanding", amount: 3_900n * USD, txHash: "0xb2", logIndex: 2 });
  });
  it("once the early-paid invoice reaches its due date it is no longer outstanding", () => {
    const later = [history[0]!, { ...history[1]!, dueSec: NOW - 1n }];
    expect(decide(later, 0n).outstanding).toBe(0n);
  });
});

describe("unknown is never positive", () => {
  it("a new counterparty gets exactly the owner's new-counterparty limit", () => {
    expect(decide([], 5_000n * USD)).toMatchObject({ ok: true, allowed: 5_000n * USD });
    expect(decide([], 5_000n * USD + 1n).ok).toBe(false);
  });
  it("with the default policy (limit 0) everything is rejected until the owner sets a limit", () => {
    expect(decide([], 1n, "buyer", DEFAULT_EXPOSURE_POLICY)).toMatchObject({ ok: false, reasonCode: "EXPOSURE_LIMIT", allowed: 0n });
    expect(decide(history, 1n, "buyer", DEFAULT_EXPOSURE_POLICY).ok).toBe(false); // maxLimit 0 caps everything
  });
  it("history that could not be read is unavailable, never a default", () => {
    expect(evaluateExposure({ side: "buyer", nowSec: NOW, newExposure: 1n, events: null, policy })).toEqual({ kind: "unavailable", reasonCode: "EVIDENCE_UNAVAILABLE" });
  });
});

describe("only verified, recent, distinct settlements grow the limit", () => {
  it("each invoice counts once, even if the indexer sends it twice or sends an earlier state too", () => {
    const noisy = [...history, history[0]!, history[1]!, approved("a1", 10_000n * USD, 0n), { ...history[0]!, state: "approved" as const }];
    expect(decide(noisy, 0n)).toMatchObject({ settledVolume: 14_000n * USD, allowed: 7_800n * USD, outstanding: 3_900n * USD });
  });
  it("a settlement without a transaction hash or log index is listed as unverified and not counted", () => {
    const d = decide([settledOnDue("c3", 10_000n * USD, 1n * DAY, { txHash: undefined })], 0n);
    expect(d.settledVolume).toBe(0n);
    expect(d.allowed).toBe(5_000n * USD);
    expect(d.evidence).toEqual([{ ref: "c3", kind: "unverified", amount: 10_000n * USD }]);
    expect(decide([settledOnDue("c4", 10_000n * USD, 1n * DAY, { logIndex: undefined })], 0n).settledVolume).toBe(0n);
  });
  it("an early payment not yet proven (not indexed) still counts as outstanding but never grows the limit", () => {
    const d = decide([settledEarly("n1", 4_000n * USD, 3_900n * USD, 20n * DAY, { txHash: undefined, logIndex: undefined, settledAtSec: undefined })], 0n);
    expect(d).toMatchObject({ outstanding: 3_900n * USD, settledVolume: 0n, allowed: 5_000n * USD });
    expect(d.evidence).toEqual([{ ref: "n1", kind: "unverified", amount: 4_000n * USD }]);
  });
  it("a local record of a payment and the same payment once indexed count once, the proven one winning", () => {
    const local = settledEarly("b2", 4_000n * USD, 3_900n * USD, 20n * DAY, { txHash: undefined, logIndex: undefined, settledAtSec: undefined });
    const d = decide([history[0]!, history[1]!, local], 0n);
    expect(d).toMatchObject({ outstanding: 3_900n * USD, settledVolume: 14_000n * USD });
  });
  it("settlements older than the look-back window do not count", () => {
    expect(decide([settledOnDue("old", 10_000n * USD, 181n * DAY)], 0n).settledVolume).toBe(0n);
    expect(decide([settledOnDue("edge", 10_000n * USD, 179n * DAY)], 0n).settledVolume).toBe(10_000n * USD);
  });
  it("growth rounds down and the hard maximum always wins", () => {
    expect(allowedLimit(policy, 1n)).toBe(5_000n * USD);
    expect(allowedLimit(policy, 3n)).toBe(5_000n * USD); // floor(3 * 2000 / 10000) = 0
    expect(allowedLimit(policy, 5n)).toBe(5_000n * USD + 1n);
    expect(allowedLimit(policy, 1_000_000n * USD)).toBe(20_000n * USD);
  });
});

describe("supplier side: credit extended to one buyer", () => {
  const owed = [approved("s1", 3_000n * USD, 10n * DAY), approved("s2", 2_000n * USD, 40n * DAY)];
  it("outstanding is the face of every approved, unpaid invoice", () => {
    expect(decide(owed, 0n, "supplier")).toMatchObject({ outstanding: 5_000n * USD, allowed: 5_000n * USD, room: 0n });
  });
  it("a new invoice that would pass the limit is rejected", () => {
    expect(decide(owed, 1n * USD, "supplier")).toMatchObject({ ok: false, reasonCode: "EXPOSURE_LIMIT" });
  });
  it("prepaid early payments are not the supplier's exposure", () => {
    expect(decide([settledEarly("b2", 4_000n * USD, 3_900n * USD, 20n * DAY)], 0n, "supplier").outstanding).toBe(0n);
  });
  it("an overdue invoice stays outstanding, is flagged overdue, and does not shrink the limit or add growth", () => {
    const late = [{ ...approved("late", 1_000n * USD, 0n), dueSec: NOW - 3n * DAY }];
    const d = decide(late, 0n, "supplier");
    expect(d.outstanding).toBe(1_000n * USD);
    expect(d.allowed).toBe(5_000n * USD); // no penalty
    expect(d.settledVolume).toBe(0n); // no growth
    expect(d.evidence[0]).toMatchObject({ kind: "overdue" });
  });
  it("just past due but inside the grace window is not called overdue (indexing delay)", () => {
    const justLate = [{ ...approved("j", 1_000n * USD, 0n), dueSec: NOW - 3_600n }];
    expect(decide(justLate, 0n, "supplier").evidence[0]).toMatchObject({ kind: "outstanding" });
  });
  it("it recovers: once the overdue invoice settles it adds growth and stops being outstanding", () => {
    const before = decide([{ ...approved("late", 1_000n * USD, 0n), dueSec: NOW - 3n * DAY }], 0n, "supplier");
    const after = decide([settledOnDue("late", 1_000n * USD, 1n * DAY)], 0n, "supplier");
    expect(before.outstanding).toBe(1_000n * USD);
    expect(after.outstanding).toBe(0n);
    expect(after.allowed).toBe(5_000n * USD + 200n * USD);
  });
  it("a disputed invoice is listed apart, adds no growth and is not called a default, but is still owed", () => {
    const d = decide([{ invoiceId: "dd", state: "disputed", face: 2_000n * USD, dueSec: NOW + DAY }], 0n, "supplier");
    expect(d.evidence).toEqual([{ ref: "dd", kind: "disputed", amount: 2_000n * USD }]);
    expect(d.settledVolume).toBe(0n);
    expect(d.allowed).toBe(5_000n * USD);
    expect(d.outstanding).toBe(2_000n * USD);
  });
  it("on the buyer side a disputed invoice is not the buyer's exposure", () => {
    expect(decide([{ invoiceId: "dd", state: "disputed", face: 2_000n * USD, dueSec: NOW + DAY }], 0n, "buyer").outstanding).toBe(0n);
  });
});

describe("determinism", () => {
  it("the same inputs give the same decision whatever the order of the events", () => {
    const a = decide(history, 3_800n * USD);
    const b = decide([...history].reverse(), 3_800n * USD);
    expect(JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(JSON.stringify(b, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });
});

import { describe, expect, it } from "vitest";
import {
  buildLadder,
  buyerCeiling,
  dealRange,
  fitsCashPath,
  highestPayableRate,
  minRateWithin,
  outflowAt,
  supplierFloor,
  type BuyerCeilingInput,
  type BuyerPolicy,
  type Candidate,
  type SupplierPrefs,
} from "../src/core/index.js";

const USD = 1_000_000n;
const DAY = 86_400n;
const F = 10_000n * USD;
const T = 30n * DAY;
const prefs: SupplierPrefs = { costOfWaitingAprBps: 2200, maxRateBps: 5000, startRateBps: 0, stepBps: 200 };
const policy = (o: Partial<BuyerPolicy> = {}): BuyerPolicy => ({ hurdleAprBps: 600, liquidityFloor: 300n * USD, perInvoiceCap: 0n, dailyCap: 0n, humanAbove: 0n, feeBps: 1000, ...o });
const ceiling = (o: Partial<BuyerCeilingInput> = {}) =>
  buyerCeiling({ face: F, secondsEarly: T, feeBps: 1000, cash: 10_200n * USD, policy: policy(), obligations: [], spentToday: 0n, ...o });

// A small seeded generator so the property tests are the same on every run.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("prices (SRS spec A.4 table, hand-computed from the contract formula)", () => {
  it("matches the worked example", () => {
    expect(outflowAt(F, 2000, T, 1000)).toBe(9_852_054_795n);
    expect(outflowAt(F, 1352, T, 1000)).toBe(9_899_989_041n);
    expect(outflowAt(F, 1351, T, 1000)).toBe(9_900_063_014n);
  });
  it("is not payable once the discount reaches the face", () => {
    const long = 3n * 365n * DAY;
    expect(outflowAt(1_000_000n, 5000, long, 1000)).toBeNull();
    expect(highestPayableRate(1_000_000n, long)).toBeLessThan(5000);
    expect(highestPayableRate(1_000_000n, long)).toBeGreaterThanOrEqual(0);
    expect(highestPayableRate(0n, T)).toBe(-1);
  });
});

describe("supplier floor", () => {
  it("S_min is the net at the highest rate the supplier will sign (cost of waiting 2200 gives 2000)", () => {
    const f = supplierFloor({ face: F, secondsEarly: T, prefs, feeBps: 1000 });
    expect(f.maxRateBps).toBe(2000);
    expect(f.floorNet).toBe(9_835_616_439n);
    expect(f.askNet).toBe(F);
  });
  it("a cost of waiting under the margin collapses the floor to the face", () => {
    const f = supplierFloor({ face: F, secondsEarly: T, prefs: { ...prefs, costOfWaitingAprBps: 100 }, feeBps: 1000 });
    expect(f.maxRateBps).toBe(0);
    expect(f.floorNet).toBe(F);
  });
});

describe("buyer ceiling (SRS spec A.4 worked example)", () => {
  it("W 10,200, R 300, no obligations: L = 9,900 and r_buy = 1352 (the liquidity term binds, not the 600 hurdle)", () => {
    const b = ceiling();
    expect(b).toMatchObject({ kind: "ok", available: 9_900n * USD, minRateBps: 1352, binding: "liquidity" });
    if (b.kind === "ok") expect(b.maxPay).toBe(9_900n * USD);
  });
  it("the feasible interval is [1352, 2000]", () => {
    const s = supplierFloor({ face: F, secondsEarly: T, prefs, feeBps: 1000 });
    expect(dealRange(s, ceiling())).toEqual({ kind: "overlap", minRateBps: 1352, maxRateBps: 2000 });
  });
  it("the ladder reaches the overlap: 0, 400, 800, 1200, 1600, 2000, and 1600 is the first rung above 1352", () => {
    const rungs = buildLadder(prefs);
    expect(rungs).toEqual([0, 400, 800, 1200, 1600, 2000]);
    expect(rungs.find((r) => r >= 1352)).toBe(1600);
  });
  it("raising the reserve to 1,000 USDC leaves no overlap, and nothing is made up", () => {
    const s = supplierFloor({ face: F, secondsEarly: T, prefs, feeBps: 1000 });
    const b = ceiling({ policy: policy({ liquidityFloor: 1_000n * USD }) });
    // 9,200 USDC is below the price at even the highest rate (5000 bps gives 9,630,136,986), so no rate fits at all
    expect(b).toMatchObject({ kind: "ok", available: 9_200n * USD, minRateBps: null });
    expect(outflowAt(F, 5000, T, 1000)).toBe(9_630_136_986n);
    expect(dealRange(s, b)).toEqual({ kind: "none", reason: "BUYER_CANNOT_PAY" });
  });
  it("NO_OVERLAP also when the supplier's ceiling is lower than the buyer's minimum", () => {
    const s = supplierFloor({ face: F, secondsEarly: T, prefs: { ...prefs, costOfWaitingAprBps: 1200 }, feeBps: 1000 }); // r_sup = 1000
    expect(dealRange(s, ceiling())).toEqual({ kind: "none", reason: "NO_OVERLAP" });
  });
  it("BUYER_CANNOT_PAY when no rate it may take fits at all", () => {
    const s = supplierFloor({ face: F, secondsEarly: T, prefs: { ...prefs, costOfWaitingAprBps: 5200 }, feeBps: 1000 });
    const b = ceiling({ cash: 5_000n * USD }); // L = 4,700 USDC, far below any price for a 10,000 USDC invoice
    expect(b).toMatchObject({ kind: "ok", minRateBps: null });
    expect(dealRange(s, b)).toEqual({ kind: "none", reason: "BUYER_CANNOT_PAY" });
  });
});

describe("independent inputs change the outcome in the expected direction (SRS acceptance 3)", () => {
  const s = supplierFloor({ face: F, secondsEarly: T, prefs, feeBps: 1000 });
  const minRate = (b: ReturnType<typeof ceiling>) => (b.kind === "ok" ? b.minRateBps : "unavailable");
  it("a bigger reserve, more obligations or a higher hurdle never lower r_buy", () => {
    const base = minRate(ceiling()) as number;
    expect(minRate(ceiling({ policy: policy({ liquidityFloor: 500n * USD }) }))).toBeGreaterThan(base);
    expect(minRate(ceiling({ obligations: [{ id: "o", dueSec: 1n, amount: 100n * USD, provenance: "declared" }] }))).toBeGreaterThan(base);
    expect(minRate(ceiling({ policy: policy({ hurdleAprBps: 1800 }) }))).toBe(1800);
  });
  it("more cash lowers r_buy until the hurdle binds", () => {
    expect(minRate(ceiling({ cash: 11_000n * USD }))).toBe(600);
    expect(minRate(ceiling({ cash: 10_200n * USD }))).toBe(1352);
  });
  it("a daily cap that is mostly spent binds as a cap and ends the deal here", () => {
    const b = ceiling({ policy: policy({ dailyCap: 9_950n * USD }), spentToday: 100n * USD });
    expect(b).toMatchObject({ kind: "ok", capRoom: 9_850n * USD, binding: "cap" });
    expect(dealRange(s, b).kind).toBe("none");
  });
  it("lowering the supplier's cost of waiting lowers its ceiling", () => {
    const hi = supplierFloor({ face: F, secondsEarly: T, prefs: { ...prefs, costOfWaitingAprBps: 2200 }, feeBps: 1000 }).maxRateBps;
    const lo = supplierFloor({ face: F, secondsEarly: T, prefs: { ...prefs, costOfWaitingAprBps: 1500 }, feeBps: 1000 }).maxRateBps;
    expect(lo).toBeLessThan(hi);
  });
});

describe("the credit limit is part of the range", () => {
  const s = supplierFloor({ face: F, secondsEarly: T, prefs, feeBps: 1000 });
  it("room under the limit raises r_buy exactly like cash would: 9,900 USDC of room gives 1352 even with huge cash", () => {
    const b = ceiling({ cash: 1_000_000n * USD, exposureRoom: 9_900n * USD });
    expect(b).toMatchObject({ kind: "ok", minRateBps: 1352, binding: "exposure" });
    expect(dealRange(s, b)).toEqual({ kind: "overlap", minRateBps: 1352, maxRateBps: 2000 });
  });
  it("too little room ends the deal even though cash is ample (SRS 6.4: enough USDC but rejected for exposure)", () => {
    const b = ceiling({ cash: 1_000_000n * USD, exposureRoom: 9_000n * USD });
    expect(b).toMatchObject({ kind: "ok", minRateBps: null });
    expect(dealRange(s, b)).toEqual({ kind: "none", reason: "BUYER_CANNOT_PAY" });
    expect(dealRange(s, ceiling({ cash: 1_000_000n * USD, exposureRoom: 9_850n * USD }))).toEqual({ kind: "none", reason: "NO_OVERLAP" });
  });
  it("no policy means no limit and no claim that one was checked", () => {
    const b = ceiling({ cash: 1_000_000n * USD });
    expect(b.kind === "ok" && b.inputs.some((x) => x.ref === "exposure")).toBe(false);
    expect(b).toMatchObject({ minRateBps: 600, binding: "hurdle" });
  });
});

describe("unavailable data fails closed and is never defaulted", () => {
  it("no balance, or no calendar, is unavailable and gives TREASURY_UNAVAILABLE", () => {
    const s = supplierFloor({ face: F, secondsEarly: T, prefs, feeBps: 1000 });
    expect(ceiling({ cash: null })).toEqual({ kind: "unavailable", missing: ["balance"] });
    expect(ceiling({ obligations: null })).toEqual({ kind: "unavailable", missing: ["obligations"] });
    expect(dealRange(s, ceiling({ cash: null, obligations: null }))).toEqual({ kind: "none", reason: "TREASURY_UNAVAILABLE" });
  });
  it("declared obligations are labelled declared", () => {
    const b = ceiling({ obligations: [{ id: "o", dueSec: 1n, amount: 1n, provenance: "declared" }] });
    expect(b.kind === "ok" && b.inputs.find((x) => x.ref === "obligations")?.provenance).toBe("declared");
  });
});

describe("property tests (seeded)", () => {
  it("minRateWithin equals a linear scan, and outflow never rises with the rate", () => {
    const r = rng(7);
    for (let n = 0; n < 400; n++) {
      const face = BigInt(1 + Math.floor(r() * 5_000_000)) * 10n ** BigInt(Math.floor(r() * 4)) * 1000n;
      const t = BigInt(1 + Math.floor(r() * 400 * 86_400));
      const fee = Math.floor(r() * 3001);
      const budget = (face * BigInt(Math.floor(r() * 1100))) / 1000n;
      const top = highestPayableRate(face, t);
      let prev: bigint | null = null;
      let linear: number | null = null;
      let rises = 0;
      for (let rate = 0; rate <= top; rate++) {
        const out = outflowAt(face, rate, t, fee)!;
        if (prev !== null && out > prev) rises++;
        prev = out;
        if (linear === null && out <= budget) linear = rate;
      }
      expect(rises).toBe(0);
      expect(minRateWithin(face, t, fee, budget)).toBe(linear);
    }
  });

  it("agrees with fitsCashPath on a single offer for random cash, floor, calendar and rate", () => {
    const r = rng(42);
    const NOW = 1_800_000_000n;
    for (let n = 0; n < 600; n++) {
      const face = BigInt(500 + Math.floor(r() * 20_000)) * USD;
      const secondsEarly = DAY * BigInt(1 + Math.floor(r() * 120));
      const p = policy({ hurdleAprBps: Math.floor(r() * 1500), liquidityFloor: BigInt(Math.floor(r() * 3000)) * USD, feeBps: Math.floor(r() * 3001) });
      const obligations = Array.from({ length: Math.floor(r() * 4) }, (_, k) => ({
        id: `o${k}`,
        dueSec: NOW + BigInt(Math.floor(r() * 200)) * DAY - 10n * DAY,
        amount: BigInt(Math.floor(r() * 3000)) * USD,
        provenance: "declared" as const,
      }));
      const cash = BigInt(Math.floor(r() * 30_000)) * USD;
      const c = ceiling({ face, secondsEarly, feeBps: p.feeBps, cash, policy: p, obligations });
      if (c.kind !== "ok") throw new Error("unexpected");
      for (let k = 0; k < 6; k++) {
        const rate = Math.floor(r() * 2500);
        const cand: Candidate = { id: "i", face, dueSec: NOW + secondsEarly, status: "approved", offerRateBps: rate, offerExpirySec: NOW + 900n };
        const fits = fitsCashPath({ nowSec: NOW, cash, policy: p, obligations, candidates: [cand] }, "i");
        const payable = highestPayableRate(face, secondsEarly) >= rate;
        const predicted = c.minRateBps !== null && rate >= c.minRateBps && payable;
        expect(predicted, `face ${face} t ${secondsEarly} rate ${rate} cash ${cash} floor ${p.liquidityFloor} hurdle ${p.hurdleAprBps}`).toBe(fits);
      }
    }
  });
});

describe("the ladder always reaches the supplier's ceiling", () => {
  it("ends exactly at the ceiling, never above it, in at most 6 rungs, in order", () => {
    const r = rng(9);
    for (let n = 0; n < 300; n++) {
      const p: SupplierPrefs = { costOfWaitingAprBps: Math.floor(r() * 5200), maxRateBps: Math.floor(r() * 5001), startRateBps: Math.floor(r() * 1500), stepBps: 1 + Math.floor(r() * 600) };
      const ceilingBps = Math.max(0, Math.min(p.maxRateBps, p.costOfWaitingAprBps - 200, 5000));
      const rungs = buildLadder(p);
      expect(rungs.length).toBeGreaterThan(0);
      expect(rungs.length).toBeLessThanOrEqual(6);
      expect(Math.max(...rungs)).toBeLessThanOrEqual(Math.max(ceilingBps, rungs[0]!));
      if (rungs[0]! < ceilingBps) expect(rungs.at(-1)).toBe(ceilingBps);
      expect([...rungs].sort((a, b) => a - b)).toEqual(rungs);
    }
  });
  it("the old stopping-short case: a widened step used to end below the ceiling 1234 and never offer it", () => {
    const rungs = buildLadder({ costOfWaitingAprBps: 5000, maxRateBps: 1234, startRateBps: 0, stepBps: 10 });
    expect(rungs.at(-1)).toBe(1234);
    expect(rungs).toHaveLength(6);
  });
});

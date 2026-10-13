import { discountOf, feeOf, MAX_RATE_BPS } from "./pricing";
import { maxRate, type SupplierPrefs } from "./ladder";
import type { BuyerPolicy } from "./policy";
import type { Obligation } from "./allocator";

/**
 * Supplier floor and buyer ceiling as explicit, deterministic functions (SRS 6.1 to 6.3).
 *
 * Money and rates: a higher rate means a lower price, so the supplier (who wants the higher price) wants a LOW rate and the
 * buyer (who wants to pay less) wants a HIGH rate. The SRS inequality `S_min <= B_max` therefore becomes an interval on the
 * rate axis, `[r_buy, r_sup]`:
 *   - r_sup  the highest rate the supplier will sign (its floor on the price it receives)
 *   - r_buy  the lowest rate the buyer will accept (its ceiling on the price it pays)
 * A deal exists iff r_buy <= r_sup. Everything is integer arithmetic on minor units and basis points. No clock, no randomness,
 * no network: the same inputs give the same answer (SRS NFR-04).
 *
 * These functions describe a side's PRIVATE range. Nothing here is put on the wire or in the public log.
 */

/** Where a value came from. A declared value may only shrink what the buyer pays, never grow it. */
export type Provenance = "onchain" | "policy" | "declared" | "unavailable";

/** What the buyer pays for an offer at `rateBps`: net + fee. null when the discount would reach the face (not payable). */
export function outflowAt(face: bigint, rateBps: number, secondsEarly: bigint, feeBps: number): bigint | null {
  const discount = discountOf(face, rateBps, secondsEarly);
  if (discount >= face) return null;
  return face - discount + feeOf(discount, feeBps);
}

/** The highest rate in 0..5000 whose discount stays below the face, or -1 when there is none (zero face). */
export function highestPayableRate(face: bigint, secondsEarly: bigint): number {
  if (face <= 0n || secondsEarly < 0n) return -1;
  if (discountOf(face, MAX_RATE_BPS, secondsEarly) < face) return MAX_RATE_BPS;
  let lo = 0; // discount(0) = 0 < face, so 0 is payable
  let hi = MAX_RATE_BPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (discountOf(face, mid, secondsEarly) < face) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The lowest rate at which the buyer pays no more than `budget`, or null when no payable rate fits. `outflowAt` never
 * increases with the rate (the fee is at most 30% of the discount), so a binary search finds the smallest one.
 */
export function minRateWithin(face: bigint, secondsEarly: bigint, feeBps: number, budget: bigint): number | null {
  const top = highestPayableRate(face, secondsEarly);
  if (top < 0) return null;
  const at = (r: number) => outflowAt(face, r, secondsEarly, feeBps)!;
  if (at(top) > budget) return null;
  let lo = 0;
  let hi = top;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid) <= budget) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// ------------------------------------------------------------------------------------------------ supplier

export interface SupplierFloorInput {
  face: bigint;
  secondsEarly: bigint;
  prefs: SupplierPrefs;
  feeBps: number;
}

export interface SupplierFloor {
  /** r_sup: the highest rate the supplier will sign. */
  maxRateBps: number;
  /** S_min: the net the supplier receives at r_sup. It signs nothing that pays it less. */
  floorNet: bigint;
  /** What the supplier receives at rate 0 (the face). */
  askNet: bigint;
}

/** S_min from the supplier's own economic policy (cost of waiting, margin, ceiling), as an amount. */
export function supplierFloor(i: SupplierFloorInput): SupplierFloor {
  const top = highestPayableRate(i.face, i.secondsEarly);
  const rate = Math.max(0, Math.min(maxRate(i.prefs), top));
  return { maxRateBps: rate, floorNet: i.face - discountOf(i.face, rate, i.secondsEarly), askNet: i.face };
}

// ------------------------------------------------------------------------------------------------ buyer

export interface BuyerObligation extends Obligation {
  /** `declared` unless a signed or on-chain record backs it. */
  provenance: Provenance;
}

export interface BuyerCeilingInput {
  face: bigint;
  secondsEarly: bigint;
  feeBps: number;
  /** The wallet's USDC balance, or null when it could not be read. */
  cash: bigint | null;
  policy: BuyerPolicy;
  /** The buyer's payment calendar, or null when it could not be read. */
  obligations: readonly BuyerObligation[] | null;
  /** Net + fee already paid early today, against the daily cap. */
  spentToday: bigint;
}

export type BuyerCeiling =
  | { kind: "unavailable"; missing: Array<"balance" | "obligations"> }
  | {
      kind: "ok";
      /** L_available = max(0, W - R - O). Each obligation is subtracted once, and R is the standing floor, never counted twice. */
      available: bigint;
      /** Room left under the per-invoice and daily caps, or null when neither is set. */
      capRoom: bigint | null;
      /** B_econ: what the buyer pays at its hurdle rate. Paying more than this earns less than the hurdle. */
      econMax: bigint;
      /** B_max = min(available, capRoom, econMax). */
      maxPay: bigint;
      /** r_buy: the lowest rate the buyer accepts, or null when no rate it is allowed to take fits. */
      minRateBps: number | null;
      /** Which term sets r_buy: the hurdle, the cash it can spare, or a cap. */
      binding: "hurdle" | "liquidity" | "cap" | null;
      /** Every input and where it came from. Declared inputs can only reduce the ceiling. */
      inputs: Array<{ ref: "balance" | "reserve" | "obligations" | "caps"; provenance: Provenance }>;
    };

/**
 * B_max and r_buy. L_available = max(0, W - R - O) with every obligation in the calendar subtracted once: the allocator's cash
 * path has no income model, so it needs the whole calendar covered (`fitsCashPath` agrees; a test asserts it).
 */
export function buyerCeiling(i: BuyerCeilingInput): BuyerCeiling {
  const missing: Array<"balance" | "obligations"> = [];
  if (i.cash === null) missing.push("balance");
  if (i.obligations === null) missing.push("obligations");
  if (i.cash === null || i.obligations === null) return { kind: "unavailable", missing };

  const owed = i.obligations.reduce((sum, o) => sum + o.amount, 0n);
  const spare = i.cash - i.policy.liquidityFloor - owed;
  const available = spare > 0n ? spare : 0n;

  const caps: bigint[] = [];
  if (i.policy.perInvoiceCap > 0n) caps.push(i.policy.perInvoiceCap);
  if (i.policy.dailyCap > 0n) {
    const left = i.policy.dailyCap - i.spentToday;
    caps.push(left > 0n ? left : 0n);
  }
  const capRoom = caps.length ? caps.reduce((a, b) => (a < b ? a : b)) : null;

  const top = highestPayableRate(i.face, i.secondsEarly);
  const hurdle = i.policy.hurdleAprBps;
  const econMax = top < 0 ? 0n : outflowAt(i.face, Math.min(hurdle, top), i.secondsEarly, i.feeBps)!;

  const budget = capRoom !== null && capRoom < available ? capRoom : available;
  const maxPay = [available, econMax, ...(capRoom !== null ? [capRoom] : [])].reduce((a, b) => (a < b ? a : b));

  const spendable = minRateWithin(i.face, i.secondsEarly, i.feeBps, budget);
  let minRateBps: number | null = null;
  let binding: "hurdle" | "liquidity" | "cap" | null = null;
  if (spendable !== null && hurdle <= top) {
    minRateBps = Math.max(hurdle, spendable);
    binding = hurdle >= spendable ? "hurdle" : capRoom !== null && capRoom < available ? "cap" : "liquidity";
  }

  const owedProvenance: Provenance = i.obligations.length === 0 ? "policy" : i.obligations.some((o) => o.provenance === "declared") ? "declared" : i.obligations.every((o) => o.provenance === "onchain") ? "onchain" : "policy";
  return {
    kind: "ok",
    available,
    capRoom,
    econMax,
    maxPay,
    minRateBps,
    binding,
    inputs: [
      { ref: "balance", provenance: "onchain" },
      { ref: "reserve", provenance: "policy" },
      { ref: "obligations", provenance: owedProvenance },
      { ref: "caps", provenance: "policy" },
    ],
  };
}

// ------------------------------------------------------------------------------------------------ deal discovery

export type DealRange =
  | { kind: "overlap"; minRateBps: number; maxRateBps: number }
  | { kind: "none"; reason: "NO_OVERLAP" | "TREASURY_UNAVAILABLE" | "BUYER_CANNOT_PAY" };

/** SRS 6.3: a deal is feasible iff S_min <= B_max, that is r_buy <= r_sup. Otherwise no deal is made up. */
export function dealRange(s: SupplierFloor, b: BuyerCeiling): DealRange {
  if (b.kind === "unavailable") return { kind: "none", reason: "TREASURY_UNAVAILABLE" };
  if (b.minRateBps === null) return { kind: "none", reason: "BUYER_CANNOT_PAY" };
  if (b.minRateBps > s.maxRateBps) return { kind: "none", reason: "NO_OVERLAP" };
  return { kind: "overlap", minRateBps: b.minRateBps, maxRateBps: s.maxRateBps };
}

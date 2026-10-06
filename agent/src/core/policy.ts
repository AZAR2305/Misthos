import { discountOf, feeOf } from "./pricing.js";

/** Reason codes the buyer agent may return. A reject never carries the hurdle value (spec 8.6). */
export const REASON_CODES = [
  "BELOW_HURDLE",
  "LIQUIDITY_FLOOR",
  "NOT_ELIGIBLE",
  "NEEDS_HUMAN_APPROVAL",
  "EXPIRED",
  "DISPUTED",
  "REPUTATION_FLAG",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface BuyerPolicy {
  /** Private. Never sent to the supplier or shown before settlement. */
  hurdleAprBps: number;
  liquidityFloor: bigint;
  /** 0 = no cap. Mirrors InvoiceBook.setLimits. */
  perInvoiceCap: bigint;
  dailyCap: bigint;
  /** Net above this goes to a human (needs_approval). 0 = never escalate. */
  humanAbove: bigint;
  feeBps: number;
}

export interface Candidate {
  id: string;
  face: bigint;
  /** Unix seconds. */
  dueSec: bigint;
  status: "approved" | "registered" | "settled" | "disputed";
  offerRateBps: number;
  offerExpirySec: bigint;
  /** A blocking reputation flag confirmed by code against the snapshot (spec 8.3 and 8.8). */
  reputationBlocked?: boolean;
}

export type Evaluation = { ok: true } | { ok: false; reason: ReasonCode; detail: string };

/**
 * Eligibility and hurdle check for one offer. Deterministic. Order matters: the first failing check wins, so the
 * reason code is stable.
 */
export function evaluateOffer(policy: BuyerPolicy, c: Candidate, nowSec: bigint): Evaluation {
  if (c.status === "disputed") return { ok: false, reason: "DISPUTED", detail: "The invoice is disputed." };
  if (c.status !== "approved") {
    return { ok: false, reason: "NOT_ELIGIBLE", detail: "Only approved invoices can be paid early." };
  }
  if (c.dueSec <= nowSec) return { ok: false, reason: "NOT_ELIGIBLE", detail: "The invoice is already due." };
  if (c.offerExpirySec < nowSec) {
    return { ok: false, reason: "EXPIRED", detail: "The offer expired. Ask for a new offer." };
  }
  if (c.reputationBlocked) {
    return { ok: false, reason: "REPUTATION_FLAG", detail: "A reputation flag blocks early payment." };
  }
  if (c.offerRateBps < policy.hurdleAprBps) {
    return { ok: false, reason: "BELOW_HURDLE", detail: "Below your hurdle." };
  }
  const secondsEarly = c.dueSec - nowSec;
  const discount = discountOf(c.face, c.offerRateBps, secondsEarly);
  if (discount >= c.face) {
    return { ok: false, reason: "NOT_ELIGIBLE", detail: "The discount would exceed the face amount." };
  }
  const net = c.face - discount;
  const outflow = net + feeOf(discount, policy.feeBps);
  if (policy.perInvoiceCap > 0n && outflow > policy.perInvoiceCap) {
    return { ok: false, reason: "NOT_ELIGIBLE", detail: "Above your per-invoice cap." };
  }
  if (policy.humanAbove > 0n && net > policy.humanAbove) {
    return { ok: false, reason: "NEEDS_HUMAN_APPROVAL", detail: "Above the amount you sign off yourself." };
  }
  return { ok: true };
}

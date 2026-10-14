import { discountOf, feeOf } from "./pricing";

/** Reason codes the buyer agent may return. A reject never carries the hurdle value (spec 8.6). */
export const REASON_CODES = [
  "BELOW_HURDLE",
  "LIQUIDITY_FLOOR",
  "NOT_ELIGIBLE",
  "NEEDS_HUMAN_APPROVAL",
  "EXPIRED",
  "DISPUTED",
  "REPUTATION_FLAG",
  "REGISTRY_UNAVAILABLE",
  "NO_OVERLAP",
  "EXPOSURE_LIMIT",
  "EVIDENCE_UNAVAILABLE",
  "TREASURY_UNAVAILABLE",
  "BUYER_CANNOT_PAY",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * One fixed sentence per code, for the UI and the audit trail. The UI never builds text from a number, and none of these
 * names a hurdle, a floor or a limit. Codes that only appear in the agents' own log are included so every code is explained.
 */
export const REASON_TEXT: Readonly<Record<string, string>> = {
  BELOW_HURDLE: "The offered rate is below what the buyer needs to pay early.",
  LIQUIDITY_FLOOR: "Paying early would take the buyer's cash under its own reserve.",
  NOT_ELIGIBLE: "This invoice cannot be paid early under the rules.",
  NEEDS_HUMAN_APPROVAL: "The amount is above what the agent may sign without a person.",
  EXPIRED: "The offer had expired.",
  DISPUTED: "The invoice is disputed, so nothing is paid until it is resolved.",
  REPUTATION_FLAG: "A reputation flag blocks early payment: either a risk flag the agent confirmed from its own records, or recent dispute ratings of the supplier agent on the public agent reputation registry.",
  REGISTRY_UNAVAILABLE: "The public agent reputation registry could not be read, so nothing is accepted.",
  NO_OVERLAP: "The supplier's lowest price and the buyer's highest price do not meet, so there is no deal.",
  EXPOSURE_LIMIT: "The payment would take the exposure to this business past its allowed limit.",
  EVIDENCE_UNAVAILABLE: "The history needed for the credit limit could not be read, so nothing is accepted.",
  TREASURY_UNAVAILABLE: "The buyer's balance or payment calendar could not be read, so nothing is accepted.",
  BUYER_CANNOT_PAY: "The buyer cannot pay this invoice early at any rate the rules allow.",
  HOLD_TO_DUE: "The agent chose to wait for the due date.",
  MODEL_UNAVAILABLE: "The strategy model was unavailable, so the agent took no action.",
  PROPOSAL_INVALID: "The strategy model's proposal did not match the required format and was ignored.",
  PARTIAL_UNSUPPORTED: "Partial early payment is not built yet.",
  BUYER_UNREACHABLE: "The other agent could not be reached.",
};

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
/** An offer with less life than this is not settled: by the time the transaction lands it could be expired. The supplier re-signs the rung instead. */
export const MIN_OFFER_LIFE_SEC = 60n;

export function evaluateOffer(policy: BuyerPolicy, c: Candidate, nowSec: bigint): Evaluation {
  if (c.status === "disputed") return { ok: false, reason: "DISPUTED", detail: "The invoice is disputed." };
  if (c.status !== "approved") {
    return { ok: false, reason: "NOT_ELIGIBLE", detail: "Only approved invoices can be paid early." };
  }
  if (c.dueSec <= nowSec) return { ok: false, reason: "NOT_ELIGIBLE", detail: "The invoice is already due." };
  if (c.offerExpirySec < nowSec + MIN_OFFER_LIFE_SEC) {
    return { ok: false, reason: "EXPIRED", detail: "The offer has expired or has too little life left to settle safely. Ask for a new offer." };
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

import { evaluateExposure, type ExposureDecision, type ExposurePolicy, type InvoiceEvent } from "./exposure";
import { fitsCashPath, type Obligation } from "./allocator";
import { evaluateOffer, type BuyerPolicy, type Candidate, type ReasonCode } from "./policy";
import { priceOffer } from "./pricing";
import { buildLadder, maxRate, type SupplierPrefs } from "./ladder";

/**
 * The buyer's decision on one offer, as a single pure function (SRS NFR-04: the same validated inputs and policy version give
 * the same decision). The agent gathers the inputs, calls this, then acts. An auditor given the logged inputs calls the same
 * function and must get the same answer (`agent/src/audit.ts`). It does no I/O, reads no clock and uses no randomness.
 *
 * Order of checks (the first failure decides, so the reason code is stable):
 *   1. eligibility and hurdle      (evaluateOffer)
 *   2. credit limit for this supplier (evaluateExposure), when the owner has set one
 *   3. liquidity: cash path above the floor with obligations and the daily cap (fitsCashPath)
 * An input that could not be read is `null`: the decision is then "needs a person", never a favourable default.
 */
export type ExposureInputs =
  | { kind: "off" }
  /** The policy or the history could not be read. */
  | { kind: "unreadable" }
  | { kind: "on"; policy: ExposurePolicy; events: readonly InvoiceEvent[] };

/**
 * What the ERC-8004 registry says about the supplier's agent, read live by the buyer. It may only block or LOWER a limit, never raise one:
 * today's ratings come from agents we run ourselves, so they are not evidence of trust, and growth stays tied to verified settled volume.
 *   off          no registry is configured: nothing changes
 *   unavailable  the read failed: the answer is "needs a person" (REGISTRY_UNAVAILABLE), never a favourable default
 *   none         the supplier has no agent identity or no feedback yet: a new address, capped by newAddressCap
 *   read         up to the 5 most recent feedback entries, newest first, each marked disputed or not
 */
export type ReputationInput =
  | { kind: "off" }
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "read"; recent: readonly { disputed: boolean }[] };

/** Two or more disputed entries among the 5 most recent block early payment pending a person. */
export const DISPUTE_FLAG_THRESHOLD = 2;
export const REPUTATION_WINDOW = 5;

export interface BuyerDecisionInput {
  nowSec: bigint;
  candidate: Candidate;
  policy: BuyerPolicy;
  treasury: { cash: bigint; obligations: readonly Obligation[] } | null;
  spentToday: bigint;
  exposure: ExposureInputs;
  /** Absent means off. */
  reputation?: ReputationInput;
  /** The most this buyer will send to a supplier with no history on the registry. Unset means a new address is not capped. */
  newAddressCap?: bigint;
}

export type CheckName = "eligibility" | "credit" | "liquidity";
export interface CheckStep {
  check: CheckName;
  result: "passed" | "failed" | "unavailable" | "skipped";
}

export type BuyerDecision =
  | { result: "accept"; steps: CheckStep[] }
  | { result: "reject"; code: ReasonCode; detail: string; steps: CheckStep[] }
  | { result: "needs_approval"; code: "NEEDS_HUMAN_APPROVAL" | "EVIDENCE_UNAVAILABLE" | "TREASURY_UNAVAILABLE" | "REGISTRY_UNAVAILABLE"; detail: string; steps: CheckStep[] };

/** The credit check's own numbers, for the log's evidence list and the audit. Never includes the limit. */
export function exposureOf(input: BuyerDecisionInput): ExposureDecision | null {
  if (input.exposure.kind !== "on") return null;
  const c = input.candidate;
  const secondsEarly = c.dueSec - input.nowSec;
  if (secondsEarly <= 0n) return null;
  const outflow = priceOffer(c.face, c.offerRateBps, secondsEarly, input.policy.feeBps).outflow;
  return evaluateExposure({ side: "buyer", nowSec: input.nowSec, newExposure: outflow, events: input.exposure.events, policy: input.exposure.policy });
}

export function decideBuyerOffer(input: BuyerDecisionInput): BuyerDecision {
  const steps: CheckStep[] = [
    { check: "eligibility", result: "skipped" },
    { check: "credit", result: "skipped" },
    { check: "liquidity", result: "skipped" },
  ];
  const set = (i: number, result: CheckStep["result"]) => void (steps[i]!.result = result);

  const ev = evaluateOffer(input.policy, input.candidate, input.nowSec);
  if (!ev.ok) {
    set(0, "failed");
    return ev.reason === "NEEDS_HUMAN_APPROVAL"
      ? { result: "needs_approval", code: "NEEDS_HUMAN_APPROVAL", detail: ev.detail, steps }
      : { result: "reject", code: ev.reason, detail: ev.detail, steps };
  }
  set(0, "passed");

  // The reputation reading comes first inside the credit step, because it can end the decision before any limit is looked at.
  const rep = input.reputation ?? { kind: "off" as const };
  if (rep.kind === "unavailable") {
    set(1, "unavailable");
    return { result: "needs_approval", code: "REGISTRY_UNAVAILABLE", detail: "The ERC-8004 reputation registry could not be read, so nothing is accepted.", steps };
  }
  if (rep.kind === "read" && rep.recent.slice(0, REPUTATION_WINDOW).filter((r) => r.disputed).length >= DISPUTE_FLAG_THRESHOLD) {
    set(1, "failed");
    return { result: "reject", code: "REPUTATION_FLAG", detail: "The supplier's agent has recent dispute ratings on the ERC-8004 registry.", steps };
  }

  if (input.exposure.kind === "unreadable") {
    set(1, "unavailable");
    return { result: "needs_approval", code: "EVIDENCE_UNAVAILABLE", detail: "The credit limit or its history could not be read, so nothing is accepted.", steps };
  }
  if (input.exposure.kind === "on") {
    const d = exposureOf(input)!;
    if (d.kind === "unavailable") {
      set(1, "unavailable");
      return { result: "needs_approval", code: "EVIDENCE_UNAVAILABLE", detail: "The history needed for the credit limit is unavailable, so nothing is accepted.", steps };
    }
    // effectiveLimit = min(exposureLimit, cap): with no history the cap is newAddressCap; otherwise the cap is the limit itself. Never above the limit.
    const cap = rep.kind === "none" && input.newAddressCap !== undefined ? input.newAddressCap : d.allowed;
    const effective = cap < d.allowed ? cap : d.allowed;
    if (!d.ok || d.newExposure + d.outstanding > effective) {
      set(1, "failed");
      return { result: "reject", code: "EXPOSURE_LIMIT", detail: "The payment would take the exposure to this supplier past its allowed limit.", steps };
    }
    set(1, "passed");
  }

  if (input.exposure.kind === "off" && rep.kind === "none" && input.newAddressCap !== undefined && input.candidate.face > 0n) {
    const secondsEarly = input.candidate.dueSec - input.nowSec;
    if (secondsEarly > 0n && priceOffer(input.candidate.face, input.candidate.offerRateBps, secondsEarly, input.policy.feeBps).outflow > input.newAddressCap) {
      set(1, "failed");
      return { result: "reject", code: "EXPOSURE_LIMIT", detail: "The supplier has no history on the registry, and this payment is above what is allowed to a new address.", steps };
    }
    set(1, "passed");
  }

  if (!input.treasury) {
    set(2, "unavailable");
    return { result: "needs_approval", code: "TREASURY_UNAVAILABLE", detail: "The treasury could not be read, so nothing is accepted.", steps };
  }
  const fits = fitsCashPath(
    { nowSec: input.nowSec, cash: input.treasury.cash, policy: input.policy, obligations: input.treasury.obligations, candidates: [input.candidate], spentToday: input.spentToday },
    input.candidate.id,
  );
  if (!fits) {
    set(2, "failed");
    return { result: "reject", code: "LIQUIDITY_FLOOR", detail: "Accepting would take the cash path under the liquidity floor, or over the daily cap.", steps };
  }
  set(2, "passed");
  return { result: "accept", steps };
}

// ------------------------------------------------------------------------------------------------ supplier

/**
 * The supplier's ladder from its inputs and whatever the model proposed. The model proposes numbers; this clamps every one into
 * the supplier's own bounds and builds the rungs, so the same inputs always give the same ladder. No rung is above the ceiling.
 */
export interface LadderInput {
  prefs: SupplierPrefs;
  pastAcceptedBps: readonly number[];
  proposedStartBps?: number;
  proposedMaxBps?: number;
}

export function planLadder(i: LadderInput): { ceilingBps: number; rungs: number[] } {
  const ceiling = maxRate(i.prefs);
  // The model may start the ask lower than the supplier's configured start, never higher: the default is the configured start (0% unless the
  // supplier set otherwise), so a model cannot talk the agent into charging for speed before the buyer has had the chance to say no.
  const configured = Math.min(Math.max(i.prefs.startRateBps, 0), ceiling);
  const start = Math.min(Math.max(i.proposedStartBps ?? configured, 0), configured);
  const max = Math.min(Math.max(i.proposedMaxBps ?? ceiling, start), ceiling);
  return { ceilingBps: ceiling, rungs: buildLadder({ ...i.prefs, startRateBps: start, maxRateBps: max }, i.pastAcceptedBps) };
}

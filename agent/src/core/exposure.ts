import { BPS, SECONDS_PER_DAY } from "./money";

/**
 * Credit and exposure policy (SRS FR-05 and 6.4). One deterministic function, integer arithmetic only, no model, no clock,
 * no network. It answers: with what this counterparty has verifiably done, and what is outstanding, may I take on one more
 * commitment? The answer is `E_new + E_outstanding <= C_allowed`.
 *
 * What exposure means, by side:
 *   supplier  credit extended: the face of this buyer's approved invoices not yet paid (`E_new` is the new invoice's face).
 *   buyer     money paid ahead of terms: the outflow of early payments to this supplier whose due date has not passed
 *             (`E_new` is the outflow of the early payment being decided).
 *
 * Rules that keep it honest:
 *   - Unknown counterparties get `newCounterpartyLimit`, which defaults to 0. Missing history is never positive evidence.
 *   - Only settlements backed by a transaction hash and log index grow the limit, and each invoice counts once.
 *   - A disputed invoice is listed, never counted as a default and never counted towards growth.
 *   - An overdue invoice stays outstanding (it is still owed) and stops adding to growth. It carries no other penalty and
 *     nothing is permanent: once it settles it counts like any other settlement and the limit recovers.
 *   - If the history cannot be read, the answer is "unavailable". It never falls back to a favourable default.
 * Limits are enforced by each agent declining to sign. The contract does not trust off-chain financial claims, so it has no
 * exposure check.
 */

export interface ExposurePolicy {
  /** Short public label, bumped whenever any rule or number changes. */
  version: string;
  /** What a counterparty with no history may be owed or prepaid. Default 0: unknown is never positive. */
  newCounterpartyLimit: bigint;
  /** Hard ceiling whatever the history says. */
  maxLimit: bigint;
  /** Basis points of recently settled volume added to the limit (2000 = 20%). */
  growthBps: number;
  /** Only settlements this recent count (days). */
  lookbackDays: number;
  /** Seconds past due before an unpaid invoice is called overdue; covers indexing delay. */
  graceSeconds: number;
}

export const DEFAULT_EXPOSURE_POLICY: ExposurePolicy = {
  version: "exposure-1",
  newCounterpartyLimit: 0n,
  maxLimit: 0n,
  growthBps: 2000,
  lookbackDays: 180,
  graceSeconds: 86_400,
};

export type InvoiceState = "approved" | "settled_early" | "settled_on_due" | "disputed";

/** One invoice between the two businesses, as the indexer read it from chain events. */
export interface InvoiceEvent {
  invoiceId: string;
  state: InvoiceState;
  face: bigint;
  /** For settled_early: what the buyer paid (net + fee). */
  outflow?: bigint;
  dueSec: bigint;
  /** Block time of the settlement. */
  settledAtSec?: bigint;
  /** The transaction and log that prove a settlement. A settlement without both is not counted. */
  txHash?: string;
  logIndex?: number;
}

export type EvidenceKind = "settlement" | "outstanding" | "overdue" | "disputed" | "unverified";

export interface ExposureEvidence {
  ref: string;
  kind: EvidenceKind;
  amount: bigint;
  txHash?: string;
  logIndex?: number;
}

export interface ExposureInput {
  side: "supplier" | "buyer";
  nowSec: bigint;
  /** E_new: the commitment being decided (face for a supplier, outflow for a buyer). */
  newExposure: bigint;
  /** Everything between these two businesses. null when the history could not be read. */
  events: readonly InvoiceEvent[] | null;
  policy: ExposurePolicy;
}

export type ExposureDecision =
  | { kind: "unavailable"; reasonCode: "EVIDENCE_UNAVAILABLE" }
  | {
      kind: "decided";
      /** True when E_new + E_outstanding <= C_allowed. */
      ok: boolean;
      reasonCode?: "EXPOSURE_LIMIT";
      /** C_allowed */
      allowed: bigint;
      /** E_outstanding */
      outstanding: bigint;
      newExposure: bigint;
      /** What a new commitment may still be: max(0, allowed - outstanding). */
      room: bigint;
      /** Verified settled volume inside the window that grew the limit. */
      settledVolume: bigint;
      evidence: ExposureEvidence[];
    };

const PRECEDENCE: Record<InvoiceState, number> = { approved: 0, disputed: 1, settled_early: 2, settled_on_due: 2 };

/** One row per invoice: if the same invoice appears twice, the furthest state wins (a settlement beats an approval). */
function onePerInvoice(events: readonly InvoiceEvent[]): InvoiceEvent[] {
  const byId = new Map<string, InvoiceEvent>();
  for (const e of events) {
    const prev = byId.get(e.invoiceId.toLowerCase());
    if (!prev || PRECEDENCE[e.state] > PRECEDENCE[prev.state]) byId.set(e.invoiceId.toLowerCase(), e);
  }
  return [...byId.values()].sort((a, b) => (a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0));
}

/** `allowed = min(maxLimit, newCounterpartyLimit + floor(settledVolume * growthBps / 10_000))`. */
export function allowedLimit(policy: ExposurePolicy, settledVolume: bigint): bigint {
  const grown = policy.newCounterpartyLimit + (settledVolume * BigInt(policy.growthBps)) / BPS;
  return grown < policy.maxLimit ? grown : policy.maxLimit;
}

export function evaluateExposure(i: ExposureInput): ExposureDecision {
  if (i.events === null) return { kind: "unavailable", reasonCode: "EVIDENCE_UNAVAILABLE" };
  const windowStart = i.nowSec - BigInt(i.policy.lookbackDays) * SECONDS_PER_DAY;
  const evidence: ExposureEvidence[] = [];
  let settledVolume = 0n;
  let outstanding = 0n;

  for (const e of onePerInvoice(i.events)) {
    const ref = e.invoiceId.toLowerCase();
    if (e.state === "settled_early" || e.state === "settled_on_due") {
      const proven = e.txHash !== undefined && e.logIndex !== undefined && e.settledAtSec !== undefined;
      if (!proven) {
        // Not provable yet (for example not indexed): it cannot grow the limit, but money already paid ahead still counts as outstanding.
        evidence.push({ ref, kind: "unverified", amount: e.face });
        if (i.side === "buyer" && e.state === "settled_early" && e.dueSec > i.nowSec) outstanding += e.outflow ?? e.face;
        continue;
      }
      if (e.settledAtSec! >= windowStart) {
        settledVolume += e.face;
        evidence.push({ ref, kind: "settlement", amount: e.face, txHash: e.txHash, logIndex: e.logIndex });
      }
      // Money paid ahead of terms stays exposure until the due date (buyer side only).
      if (i.side === "buyer" && e.state === "settled_early" && e.dueSec > i.nowSec) {
        const paid = e.outflow ?? e.face;
        outstanding += paid;
        evidence.push({ ref, kind: "outstanding", amount: paid, txHash: e.txHash, logIndex: e.logIndex });
      }
      continue;
    }
    if (e.state === "disputed") {
      evidence.push({ ref, kind: "disputed", amount: e.face });
      if (i.side === "supplier") outstanding += e.face; // still owed, but listed as disputed and never counted as a default
      continue;
    }
    // approved and not settled
    if (i.side === "supplier") {
      outstanding += e.face;
      evidence.push({ ref, kind: e.dueSec + BigInt(i.policy.graceSeconds) < i.nowSec ? "overdue" : "outstanding", amount: e.face });
    }
  }

  const allowed = allowedLimit(i.policy, settledVolume);
  const room = allowed > outstanding ? allowed - outstanding : 0n;
  const ok = i.newExposure + outstanding <= allowed;
  return { kind: "decided", ok, ...(ok ? {} : { reasonCode: "EXPOSURE_LIMIT" as const }), allowed, outstanding, newExposure: i.newExposure, room, settledVolume, evidence };
}

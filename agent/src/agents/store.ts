import { GENESIS_HASH, hashDecision, verifyChain, type DecisionEntry, type StoredDecision } from "../core/index.js";

/**
 * Append-only, hash-chained decision log (spec 8.4). This process-local store is the real log for one agent process;
 * the backend persists the same entries to Postgres. `hash` is what goes on-chain as `decisionHash` in settleEarly.
 *
 * reasonCode records why an item waits for a human (MODEL_UNAVAILABLE, SESSION_EXPIRED, ...): spec 0.5 and 8.5 #6.
 */
export type DecisionOutcome = DecisionEntry["outcome"];

export interface DecisionInput {
  actor: DecisionEntry["actor"];
  invoiceId: string;
  /** Numbers and opaque ids only. Invoice descriptions and other free text never go in a snapshot (spec 8.5 #1). */
  snapshot: unknown;
  proposal: unknown;
  outcome: DecisionOutcome;
  reasonCode?: string;
  reason: string;
}

export class DecisionStore {
  private entries: StoredDecision[] = [];
  private meta: Array<{ invoiceId: string; reasonCode?: string; at: number }> = [];

  append(input: DecisionInput, nowSec: number): StoredDecision {
    const prevHash = this.entries.at(-1)?.hash ?? GENESIS_HASH;
    const entry: DecisionEntry = {
      prevHash,
      actor: input.actor,
      snapshot: { invoiceId: input.invoiceId, ...(input.snapshot as object) },
      proposal: input.proposal,
      outcome: input.outcome,
      reason: input.reasonCode ? `${input.reasonCode}: ${input.reason}` : input.reason,
    };
    const stored: StoredDecision = { ...entry, hash: hashDecision(entry) };
    this.entries.push(stored);
    this.meta.push({ invoiceId: input.invoiceId, reasonCode: input.reasonCode, at: nowSec });
    return stored;
  }

  all(): readonly StoredDecision[] {
    return this.entries;
  }

  forInvoice(invoiceId: string): StoredDecision[] {
    return this.entries.filter((_, i) => this.meta[i]!.invoiceId === invoiceId);
  }

  /** GET /api/log/verify: recompute the chain. */
  verify() {
    return verifyChain(this.entries);
  }
}

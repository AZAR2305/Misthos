import type { LogEntry } from "./trace";

/**
 * Where an early payment stands (SRS FR-08). It is derived only from three real sources and never guessed:
 *   - the signed log: offers signed and the buyer agent's accept;
 *   - a wallet or settlement failure the agent logged after accepting;
 *   - the chain: an indexed settlement event.
 * Arc finalises deterministically, so a settlement the chain shows is both confirmed and settled; there is no separate
 * "confirmed" state to invent. A pending or failed attempt is never shown as paid: only the chain can say "settled".
 */
export type PayState = "none" | "proposed" | "accepted" | "failed" | "settled";

/** Codes that mean the buyer's wallet or the settlement call failed after the buyer agent had decided to accept. */
const NOT_A_FAILURE = new Set(["EXPOSURE_LIMIT", "LIQUIDITY_FLOOR", "TREASURY_UNAVAILABLE", "EVIDENCE_UNAVAILABLE", "NEEDS_HUMAN_APPROVAL", "NO_OVERLAP", "HOLD_TO_DUE"]);

export interface PayStateResult {
  state: PayState;
  label: string;
  /** One sentence for a tooltip or a line under the chip. */
  detail: string;
  /** The failure code the agent logged, when state is "failed". */
  code?: string;
}

export function payState(args: { chainStatus: string; entries: readonly LogEntry[] }): PayStateResult {
  if (args.chainStatus === "settled_early" || args.chainStatus === "settled_due") {
    return { state: "settled", label: "Settled", detail: "The settlement is on Arc. The transaction link proves it." };
  }
  const entries = [...args.entries].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const acceptIdx = entries.map((e) => (e.actor === "buyer_agent" && e.outcome === "auto_apply" && (e.snapshot.result as { code?: string } | undefined)?.code === "ACCEPT" ? true : false)).lastIndexOf(true);
  if (acceptIdx >= 0) {
    const after = entries.slice(acceptIdx + 1).find((e) => e.actor === "buyer_agent" && e.outcome === "needs_approval" && e.reasonCode && !NOT_A_FAILURE.has(e.reasonCode));
    if (after) return { state: "failed", label: "Payment failed", detail: "The buyer agent accepted, but its wallet could not send the payment. Nothing was paid.", code: after.reasonCode ?? undefined };
    return { state: "accepted", label: "Accepted, settling", detail: "The buyer agent accepted and sent the payment. It counts as paid only once Arc shows it." };
  }
  if (entries.some((e) => e.actor === "supplier_agent" && typeof e.snapshot.rung === "number")) {
    return { state: "proposed", label: "Offered", detail: "The supplier agent has signed an offer. No payment has been accepted." };
  }
  return { state: "none", label: "No offer yet", detail: "No early-payment offer has been signed for this invoice." };
}

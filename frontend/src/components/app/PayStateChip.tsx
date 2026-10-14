"use client";

import type { PayStateResult } from "@/lib/paystate";

/**
 * Where an early payment stands, beside the invoice status (SRS FR-08). Icon plus word, never colour alone. Only the chain can
 * make an invoice "settled", so this chip stays silent for none and settled: the status chip already says it.
 */
export function PayStateChip({ state }: { state: PayStateResult }) {
  if (state.state === "none" || state.state === "settled") return null;
  const tone = state.state === "failed" ? "bad" : "outline";
  const icon = state.state === "failed" ? "!" : state.state === "accepted" ? "…" : "◦";
  return (
    <span className="chip" data-tone={tone} title={state.detail}>
      <span aria-hidden="true">{icon}</span> {state.label}
    </span>
  );
}

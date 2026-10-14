"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiEnabled } from "./api";
import { type ExposurePolicy, type InvoiceEvent } from "./core";

/**
 * Credit limits and the history behind them (SRS FR-05). The policy is the owner's own, saved on the server and versioned. The
 * history is public chain data the indexer read, each settlement with its transaction. The page computes the decision with the
 * same pure function the agents run, so what it shows is what an agent would decide. Anything the server cannot answer is
 * "unavailable", never a default.
 */
const uint = /^\d{1,30}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The server's policy reply into a policy, `null` when none is set, or `undefined` when the reply is not what it should be. */
export function parsePolicy(raw: unknown): ExposurePolicy | null | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.configured === false) return null;
  if (raw.configured !== true) return undefined;
  const { version, newCounterpartyLimit: n, maxLimit: m, growthBps, lookbackDays, graceSeconds } = raw;
  if (typeof version !== "string" || typeof n !== "string" || typeof m !== "string" || !uint.test(n) || !uint.test(m)) return undefined;
  if (![growthBps, lookbackDays, graceSeconds].every((x) => typeof x === "number" && Number.isInteger(x) && x >= 0)) return undefined;
  return { version, newCounterpartyLimit: BigInt(n), maxLimit: BigInt(m), growthBps: growthBps as number, lookbackDays: lookbackDays as number, graceSeconds: graceSeconds as number };
}

const STATES = ["approved", "settled_early", "settled_on_due", "disputed"] as const;

/** The server's history reply into events, or `undefined` if any row is malformed (then the whole answer is unavailable). */
export function parseEvents(raw: unknown): InvoiceEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: InvoiceEvent[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.invoiceId !== "string" || !(STATES as readonly unknown[]).includes(r.state) || typeof r.face !== "string" || !uint.test(r.face) || typeof r.dueSec !== "number") return undefined;
    if (r.outflow !== undefined && (typeof r.outflow !== "string" || !uint.test(r.outflow))) return undefined;
    if (r.settledAtSec !== undefined && typeof r.settledAtSec !== "number") return undefined;
    if (r.txHash !== undefined && typeof r.txHash !== "string") return undefined;
    if (r.logIndex !== undefined && typeof r.logIndex !== "number") return undefined;
    out.push({
      invoiceId: r.invoiceId,
      state: r.state as InvoiceEvent["state"],
      face: BigInt(r.face),
      ...(r.outflow !== undefined ? { outflow: BigInt(r.outflow as string) } : {}),
      dueSec: BigInt(r.dueSec),
      ...(r.settledAtSec !== undefined ? { settledAtSec: BigInt(r.settledAtSec as number) } : {}),
      ...(r.txHash !== undefined ? { txHash: r.txHash as string } : {}),
      ...(r.logIndex !== undefined ? { logIndex: r.logIndex as number } : {}),
    });
  }
  return out;
}

export type PolicyState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "signed-out" }
  | { status: "ready"; side: "supplier" | "buyer"; policy: ExposurePolicy | null };

/** The signed-in owner's credit policy. `save` stores a new version and resolves to an error message, or null. */
export function useExposurePolicy(): PolicyState & { reload(): void; save(p: { newCounterpartyLimit: string; maxLimit: string; growthBps: number; lookbackDays: number; graceSeconds: number }): Promise<string | null> } {
  const [state, setState] = useState<PolicyState>({ status: apiEnabled ? "loading" : "unavailable", ...(apiEnabled ? {} : { reason: "This site is not connected to a Misthos server." }) } as PolicyState);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!apiEnabled) return;
    let live = true;
    void api<unknown>("/api/exposure-policy").then((r) => {
      if (!live) return;
      if (!r.ok) return setState(r.error.code === "SIGNED_OUT" ? { status: "signed-out" } : { status: "unavailable", reason: r.error.message });
      const side = (r.data as { side?: string }).side;
      const policy = parsePolicy(r.data);
      setState(policy !== undefined && (side === "supplier" || side === "buyer") ? { status: "ready", side, policy } : { status: "unavailable", reason: "The server's answer was not understood." });
    });
    return () => {
      live = false;
    };
  }, [n]);
  const save = useCallback(async (p: Parameters<ReturnType<typeof useExposurePolicy>["save"]>[0]) => {
    const r = await api("/api/exposure-policy", { method: "PUT", body: p });
    if (!r.ok) return r.error.message;
    setN((x) => x + 1);
    return null;
  }, []);
  return { ...state, reload: () => setN((x) => x + 1), save };
}

export type HistoryState = { status: "loading" } | { status: "unavailable"; reason: string } | { status: "ready"; events: InvoiceEvent[] };

/** The invoices between two businesses, from indexed chain events. Public data: no sign-in needed. */
export function useExposureHistory(side: "supplier" | "buyer", owner?: string, counterparty?: string): HistoryState {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  useEffect(() => {
    if (!owner || !counterparty) return setState({ status: "unavailable", reason: "Connect your wallet to see the history with this business." });
    if (!apiEnabled) return setState({ status: "unavailable", reason: "This site is not connected to a Misthos server." });
    let live = true;
    void api<{ events: unknown }>(`/api/exposure?side=${side}&owner=${owner.toLowerCase()}&counterparty=${counterparty.toLowerCase()}`).then((r) => {
      if (!live) return;
      if (!r.ok) return setState({ status: "unavailable", reason: r.error.message });
      const events = parseEvents(r.data.events);
      setState(events ? { status: "ready", events } : { status: "unavailable", reason: "The server's answer was not understood." });
    });
    return () => {
      live = false;
    };
  }, [side, owner, counterparty]);
  return state;
}

/** Fixed, plain-language labels for the evidence kinds the exposure function reports. */
export const EVIDENCE_LABEL: Record<string, string> = {
  settlement: "Settled on Arc",
  outstanding: "Still outstanding",
  overdue: "Overdue (still owed)",
  disputed: "Disputed (listed apart, not a default)",
  unverified: "Not provable yet (not counted)",
};

/** "20" or "12.5" percent into basis points, or undefined. Integer arithmetic: no floats near a limit. */
export function percentToBps(input: string): number | undefined {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return undefined;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps <= 10_000 ? bps : undefined;
}

export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/**
 * The commitment a page should test against the limit for one invoice. A supplier's approved invoice is already part of what is
 * outstanding, so counting it again as "new" would show a false over-limit; one that is only registered is not counted yet, so
 * its face is the new commitment. A buyer's worst case is the full price (the price at a 0% rate).
 */
export function newExposureFor(side: "supplier" | "buyer", invoiceId: string, face: bigint, events: readonly InvoiceEvent[]): bigint {
  if (side === "buyer") return face;
  const id = invoiceId.toLowerCase();
  return events.some((e) => e.invoiceId.toLowerCase() === id && (e.state === "approved" || e.state === "disputed")) ? 0n : face;
}

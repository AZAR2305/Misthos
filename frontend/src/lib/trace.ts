import { REASON_TEXT } from "./core";

/**
 * The negotiation trace for one invoice, built only from the signed decision log (SRS section 10 view C). Nothing here is
 * invented: a rung appears when an agent logged it, with the code that agent logged. The text for each code is fixed in
 * `REASON_TEXT`, so a page never builds an explanation from a number, and no limit, hurdle or floor can reach it (the log
 * never contains one).
 */
export interface LogEntry {
  actor: "supplier_agent" | "buyer_agent";
  hash: string;
  prevHash?: string;
  outcome: "auto_apply" | "needs_approval" | "rejected";
  reason: string;
  reasonCode?: string | null;
  /** Unix seconds when the agent decided. */
  at?: number;
  snapshot: Record<string, unknown>;
  proposal?: unknown;
  policyVersion?: string | null;
  /** True once the API has verified the entry's hash chain and signature. */
  signed?: boolean;
  settlement?: { txHash: string } | null;
}

export interface TraceRung {
  /** Position on the ladder, or null for an accept made on request outside a ladder. */
  rung: number | null;
  rateBps: number;
  /** The code the agent logged, or ACCEPT. */
  code: string;
  accepted: boolean;
  text: string;
  policyVersion?: string;
  hash: string;
  at?: number;
  /** How many on-chain records the credit check rested on, and what it found. */
  credit?: { version: string; result: "ok" | "limit"; evidenceCount: number };
  signed: boolean;
}

export interface Trace {
  rungs: TraceRung[];
  /** The supplier's opening line: how many rungs and where the ask starts (never where it ends). */
  ladder?: { count: number; startBps: number; hash: string };
  /** Set when the agents ended without a deal because the two price ranges do not overlap. */
  noDeal?: { text: string; hash: string };
  /** Anything waiting for a person, with the fixed text for its code. */
  waiting: Array<{ actor: LogEntry["actor"]; code: string; text: string; hash: string }>;
  policyVersions: string[];
  /** The accepting entry, when there is one. */
  accepted?: TraceRung;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const textFor = (code: string) => (code === "ACCEPT" ? "Accepted" : (REASON_TEXT[code] ?? code));

function creditOf(snapshot: Record<string, unknown>, policyVersion?: string): TraceRung["credit"] {
  const e = snapshot.exposure as { policyVersion?: string; result?: string; evidence?: unknown[] } | undefined;
  if (!e || (e.result !== "ok" && e.result !== "limit")) return undefined;
  return { version: e.policyVersion ?? policyVersion ?? "", result: e.result, evidenceCount: Array.isArray(e.evidence) ? e.evidence.length : 0 };
}

export function buildTrace(entries: readonly LogEntry[]): Trace {
  const sorted = [...entries].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const byRung = new Map<number, TraceRung>();
  const extra: TraceRung[] = [];
  const waiting: Trace["waiting"] = [];
  let ladder: Trace["ladder"];
  let noDeal: Trace["noDeal"];
  const versions = new Set<string>();

  for (const e of sorted) {
    const snap = e.snapshot ?? {};
    const pv = e.policyVersion ?? (typeof snap.policyVersion === "string" ? snap.policyVersion : undefined);
    if (pv) versions.add(pv);
    const code = e.reasonCode ?? undefined;

    if (e.actor === "supplier_agent") {
      const open = /^Accelerate now: (\d+) rungs, starting at (\d+) bps/.exec(e.reason);
      if (open) ladder = { count: Number(open[1]), startBps: Number(open[2]), hash: e.hash };
      if (code === "NO_OVERLAP") noDeal = { text: textFor("NO_OVERLAP"), hash: e.hash };
      // The supplier's own record of a rung is the fallback when the buyer's log is not available.
      const rung = num(snap.rung);
      const rate = num(snap.rateBps);
      if (rung !== undefined && rate !== undefined && !byRung.has(rung)) {
        const accepted = /accepted at/.test(e.reason);
        const m = /rejected: ([A-Z_]+)/.exec(e.reason);
        if (accepted || m) byRung.set(rung, { rung, rateBps: rate, code: accepted ? "ACCEPT" : m![1]!, accepted, text: textFor(accepted ? "ACCEPT" : m![1]!), policyVersion: pv, hash: e.hash, at: e.at, signed: !!e.signed });
      }
      if (e.outcome === "needs_approval" && code) waiting.push({ actor: e.actor, code, text: textFor(code), hash: e.hash });
      continue;
    }

    // The buyer's entry is the decision itself: it carries the code, the policy version and the credit check.
    const result = (snap.result as { code?: string } | undefined)?.code ?? code;
    const rate = num(snap.rateBps);
    if (e.outcome === "needs_approval" && result) waiting.push({ actor: e.actor, code: result, text: textFor(result), hash: e.hash });
    if (rate === undefined || !result) continue;
    const accepted = result === "ACCEPT";
    const row: TraceRung = { rung: num(snap.rung) ?? null, rateBps: rate, code: result, accepted, text: textFor(result), policyVersion: pv, hash: e.hash, at: e.at, credit: creditOf(snap, pv), signed: !!e.signed };
    if (row.rung === null) extra.push(row);
    else byRung.set(row.rung, row);
  }

  const rungs = [...[...byRung.values()].sort((a, b) => a.rung! - b.rung!), ...extra];
  return { rungs, ladder, noDeal, waiting, policyVersions: [...versions], accepted: rungs.find((r) => r.accepted) };
}

/** Position of a rate on a range bar, 0 to 100, with a little room so the last mark is not on the edge. */
export function barPosition(rateBps: number, axisMaxBps: number): number {
  if (axisMaxBps <= 0) return 0;
  return Math.max(0, Math.min(100, (rateBps / axisMaxBps) * 100));
}

/** The right-hand end of the bar: the highest rate shown, rounded up to a clean 500 bps and never below 1000. */
export function axisMax(rates: readonly number[]): number {
  const top = Math.max(1000, ...rates);
  return Math.ceil((top * 1.1) / 500) * 500;
}

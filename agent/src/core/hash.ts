import { keccak256, toHex } from "viem";

/** Deterministic JSON: sorted object keys, bigint as decimal strings, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    return v;
  });
}

export const GENESIS_HASH = ("0x" + "00".repeat(32)) as `0x${string}`;

export interface DecisionEntry {
  prevHash: `0x${string}`;
  actor: "supplier_agent" | "buyer_agent";
  /** The inputs the agent saw. Free text from invoices is never part of a snapshot (spec 8.5). */
  snapshot: unknown;
  /** What the model proposed, if a model was involved. */
  proposal: unknown;
  outcome: "auto_apply" | "needs_approval" | "rejected";
  reason: string;
}

/** hash = keccak256(canonicalJson({prev_hash, actor, snapshot, proposal, outcome, reason})) (spec 8.4). */
export function hashDecision(e: DecisionEntry): `0x${string}` {
  const body = {
    prev_hash: e.prevHash,
    actor: e.actor,
    snapshot: e.snapshot,
    proposal: e.proposal,
    outcome: e.outcome,
    reason: e.reason,
  };
  return keccak256(toHex(canonicalJson(body)));
}

export interface StoredDecision extends DecisionEntry {
  hash: `0x${string}`;
}

/** Recompute the chain. Returns ok, or the index of the first entry that does not verify. */
export function verifyChain(entries: readonly StoredDecision[]): { ok: true } | { ok: false; badIndex: number } {
  let prev: `0x${string}` = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.prevHash !== prev || hashDecision(e) !== e.hash) return { ok: false, badIndex: i };
    prev = e.hash;
  }
  return { ok: true };
}

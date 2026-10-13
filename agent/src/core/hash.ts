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

/**
 * Names of private policy values. The decision log is public (GET /api/log returns every snapshot), so none of these may
 * appear as a key anywhere inside a logged snapshot or proposal. Private values are committed by a salted hash instead.
 */
export const PRIVATE_KEYS = [
  "costOfWaitingAprBps",
  "maxRateBps",
  "hurdleAprBps",
  "hurdle",
  "liquidityFloor",
  "perInvoiceCap",
  "dailyCap",
  "humanAbove",
  "newCounterpartyLimit",
  "maxLimit",
  "growthBps",
  "salt",
] as const;

/** The first private key name found anywhere inside a value, or undefined. */
export function findPrivateKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const v of value) {
      const f = findPrivateKey(v);
      if (f) return f;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((PRIVATE_KEYS as readonly string[]).includes(k)) return k;
      const f = findPrivateKey(v);
      if (f) return f;
    }
  }
  return undefined;
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

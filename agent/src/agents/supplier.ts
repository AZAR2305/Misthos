import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  MAX_RATE_BPS,
  planLadder,
  offerTypedData,
  type Domain,
  type ReasonCode,
  type SupplierPrefs,
} from "../core/index.js";
import {
  negotiateReplySchema,
  offerHashOf,
  verifyMessage,
  type NegotiateReply,
  type OfferMsg,
  type OfferPayload,
} from "../protocol/index.js";
import { WalletError, type Address, type SignatureVerifier, type WalletAdapter } from "../wallets/types.js";
import { ModelUnavailableError, ProposalInvalidError, type AgentModel } from "./model.js";
import { DecisionStore } from "./store.js";

/**
 * The supplier agent (CLAUDE.md 8.2). It decides whether to accelerate an invoice, where to start its ask and how far
 * to climb, and signs each rung. It starts at 0% by default and climbs only while its cost of waiting justifies it.
 * Private: the supplier's cost of waiting. It never learns the buyer's hurdle: a reject carries only a reason code.
 */

/** What the model may propose. Strict: unknown fields are rejected. Code clamps every number. */
export const supplierProposalSchema = z.strictObject({
  action: z.enum(["accelerate_now", "wait", "partial"]),
  start_rate_bps: z.number().int().min(0).max(MAX_RATE_BPS).optional(),
  max_rate_bps: z.number().int().min(0).max(MAX_RATE_BPS).optional(),
  reason: z.string().max(400),
  evidence_refs: z.array(z.string().max(40)).max(8),
});
export type SupplierProposal = z.infer<typeof supplierProposalSchema>;

/** Refs the model may cite. Anything else fails validation (spec 8.5 #3: every evidence_ref exists in the snapshot). */
const EVIDENCE_REFS = ["invoice", "prefs", "history", "buyer_reputation"] as const;

export interface SupplierInvoice {
  /** The EIP-712 invoice id (bytes32). */
  id: `0x${string}`;
  face: bigint;
  dueSec: bigint;
  status: "approved" | "registered" | "settled" | "disputed";
  /** Rates this buyer accepted before (basis points), from the ledger. */
  pastAcceptedBps: readonly number[];
}

export type NegotiationResult =
  | { kind: "accepted"; rung: number; rateBps: number; offerHash: `0x${string}` }
  | { kind: "hold_to_due"; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "needs_approval"; reasonCode: string; reason: string };

export type Transport = (msg: OfferMsg) => Promise<unknown>;

/** POST {buyerUrl}/negotiate. The reply is validated against the strict schema by the caller. */
export function httpTransport(buyerUrl: string, timeoutMs = 20_000): Transport {
  return async (msg) => {
    const res = await fetch(`${buyerUrl}/negotiate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json()) as { ok?: boolean; data?: unknown; error?: { message?: string } };
    if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `The buyer agent answered ${res.status}.`);
    return body.data;
  };
}

export interface SupplierDeps {
  wallet: WalletAdapter;
  domain: Domain;
  model: AgentModel;
  prefs: SupplierPrefs;
  store: DecisionStore;
  transport: Transport;
  /** The buyer agent's wallet address: replies from anyone else are rejected. */
  buyerAgent: Address;
  verifier: SignatureVerifier;
  rungSeconds: number;
  /** POST /pause/:invoiceId: checked before every rung. */
  shouldStop?: (invoiceId: string) => boolean;
  now?: () => number;
}

/** Reasons that mean climbing further cannot help. */
const STOP_CODES: readonly ReasonCode[] = ["DISPUTED", "NOT_ELIGIBLE", "REPUTATION_FLAG", "NEEDS_HUMAN_APPROVAL"];

export class SupplierAgent {
  /** Rungs sent and their outcomes: the negotiation transcript (shown on /invoices/[id]). */
  readonly transcript: Array<{ rung: number; rateBps: number; outcome: "accepted" | ReasonCode }> = [];
  private readonly now: () => number;

  constructor(private readonly d: SupplierDeps) {
    this.now = d.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async start(inv: SupplierInvoice): Promise<NegotiationResult> {
    const nowSec = this.now();
    const secondsEarly = inv.dueSec - BigInt(nowSec);
    if (inv.status !== "approved") return { kind: "skipped", reason: "Only approved invoices can be accelerated." };
    if (secondsEarly <= 0n) return { kind: "skipped", reason: "The invoice is already due." };

    // Numbers and opaque ids only: no invoice description, no supplier or buyer names (spec 8.5 #1).
    const snapshot = {
      invoice: { face: inv.face, secondsEarly },
      prefs: this.d.prefs,
      history: { pastAcceptedBps: inv.pastAcceptedBps },
      allowedRefs: EVIDENCE_REFS,
    };
    // What the public log gets: the invoice and counts, never the supplier's private settings (finding F-0).
    const logged = { invoice: { face: inv.face, secondsEarly }, pastAcceptedCount: inv.pastAcceptedBps.length };

    let proposal: SupplierProposal;
    try {
      proposal = await this.d.model.propose({
        role: "supplier",
        task: "Decide whether to accelerate this invoice now, and optionally propose a start rate and a maximum rate in basis points.",
        snapshot,
        schema: supplierProposalSchema,
      });
      for (const ref of proposal.evidence_refs) {
        if (!(EVIDENCE_REFS as readonly string[]).includes(ref)) throw new ProposalInvalidError(`Unknown evidence ref "${ref}".`);
      }
    } catch (e) {
      const code = e instanceof ModelUnavailableError || e instanceof ProposalInvalidError ? e.code : "MODEL_ERROR";
      this.log(inv, logged, null, "needs_approval", (e as Error).message, code);
      return { kind: "needs_approval", reasonCode: code, reason: (e as Error).message };
    }

    // The model's rates and free-text reason stay out of the public log: they can echo the supplier's private bounds.
    const publicProposal = { action: proposal.action, evidence_refs: proposal.evidence_refs };
    if (proposal.action === "wait") {
      this.log(inv, logged, publicProposal, "rejected", "The agent decided to wait for the due date.", "HOLD_TO_DUE");
      return { kind: "hold_to_due", reason: "The agent decided to wait for the due date." };
    }
    if (proposal.action === "partial") {
      // Partial acceleration is Tier 3 (spec 8.2). Do not guess: hand it to a person.
      this.log(inv, logged, publicProposal, "needs_approval", "Partial acceleration is not built yet.", "PARTIAL_UNSUPPORTED");
      return { kind: "needs_approval", reasonCode: "PARTIAL_UNSUPPORTED", reason: "Partial acceleration is not built yet." };
    }

    // Code clamps whatever the model proposed into the supplier's configured bounds (the same pure function an auditor replays).
    const ladderInput = { prefs: this.d.prefs, pastAcceptedBps: inv.pastAcceptedBps, proposedStartBps: proposal.start_rate_bps, proposedMaxBps: proposal.max_rate_bps };
    const { ceilingBps, rungs: ladder } = planLadder(ladderInput);
    // The top rung is the supplier's private ceiling, so the log says where the ask starts and how many rungs, not where it ends.
    // The private inputs and the ladder are committed to, and kept only in this agent's own file.
    this.log(inv, { ...logged, result: { code: "ACCEPT" } }, publicProposal, "auto_apply", `Accelerate now: ${ladder.length} rungs, starting at ${ladder[0]} bps.`, undefined, { ...ladderInput, face: inv.face, secondsEarly, ceilingBps, rungs: ladder });

    const firstRung = this.transcript.length; // the transcript spans invoices; judge only this negotiation
    for (let rung = 0; rung < ladder.length; rung++) {
      if (this.d.shouldStop?.(inv.id)) {
        this.log(inv, { rung }, null, "rejected", "Paused by a person before rung " + rung + ".");
        return { kind: "hold_to_due", reason: "Paused by a person." };
      }
      const rateBps = ladder[rung]!;
      let result: NegotiationResult | "continue";
      try {
        result = await this.sendRung(inv, rung, rateBps);
      } catch (e) {
        if (e instanceof WalletError) {
          // No fallback wallet: stop and wait for a person (spec 5.6).
          this.log(inv, { rung, rateBps }, null, "needs_approval", e.message, e.code);
          return { kind: "needs_approval", reasonCode: e.code, reason: e.hint ? `${e.message} ${e.hint}` : e.message };
        }
        this.log(inv, { rung, rateBps }, null, "needs_approval", (e as Error).message, "BUYER_UNREACHABLE");
        return { kind: "needs_approval", reasonCode: "BUYER_UNREACHABLE", reason: (e as Error).message };
      }
      if (result !== "continue") return result;
    }
    // Every rung up to the supplier's own ceiling was turned down for price or cash reasons: the two ranges do not overlap, so
    // no deal is made up and the invoice stays on its normal terms (SRS 6.3).
    const priceOnly = this.transcript.slice(firstRung).every((t) => t.outcome === "BELOW_HURDLE" || t.outcome === "LIQUIDITY_FLOOR" || t.outcome === "EXPOSURE_LIMIT");
    if (priceOnly) {
      this.log(inv, { rungs: ladder.length }, null, "rejected", "Every rung was rejected: the supplier's price range and the buyer's do not overlap. Hold to the due date.", "NO_OVERLAP");
      return { kind: "hold_to_due", reason: "No deal: the two sides' price ranges do not overlap, so the invoice stays on its normal terms." };
    }
    this.log(inv, { rungs: ladder.length }, null, "rejected", "Every rung was rejected: hold to the due date.");
    return { kind: "hold_to_due", reason: "No rung was accepted, so the invoice stays on its normal terms." };
  }

  private async sendRung(inv: SupplierInvoice, rung: number, rateBps: number): Promise<NegotiationResult | "continue"> {
    const nowSec = this.now();
    const payload: OfferPayload = {
      invoiceId: inv.id,
      rateBps,
      expiry: String(nowSec + this.d.rungSeconds),
      nonce: BigInt("0x" + randomBytes(16).toString("hex")).toString(), // 128-bit, single-use on chain
    };
    const from = await this.d.wallet.address();
    const offerSig = await this.d.wallet.signTypedData(
      offerTypedData(this.d.domain, { invoiceId: payload.invoiceId, rateBps, expiry: BigInt(payload.expiry), nonce: BigInt(payload.nonce) }) as never,
    );
    const msg: OfferMsg = { v: 1, type: "offer", invoiceId: inv.id, rung, offer: payload, offerSig, from, ts: nowSec };

    const raw = await this.d.transport(msg);
    const parsed = negotiateReplySchema.safeParse(raw);
    if (!parsed.success) throw new Error("The buyer agent sent a reply that does not match the protocol.");
    const reply: NegotiateReply = parsed.data;

    const verified = await verifyMessage(this.d.verifier, this.d.domain, reply, this.d.buyerAgent);
    if (!verified.ok) throw new Error(`The reply was not signed by the buyer agent (${verified.failure}).`);
    if (reply.invoiceId !== inv.id.toLowerCase() || reply.rung !== rung) throw new Error("The reply does not match the offer that was sent.");

    if (reply.type === "accept") {
      if (reply.offerHash !== offerHashOf(this.d.domain, payload)) throw new Error("The accept refers to a different offer.");
      this.transcript.push({ rung, rateBps, outcome: "accepted" });
      this.log(inv, { rung, rateBps }, null, "auto_apply", `Rung ${rung} accepted at ${rateBps} bps.`);
      return { kind: "accepted", rung, rateBps, offerHash: reply.offerHash };
    }
    this.transcript.push({ rung, rateBps, outcome: reply.reasonCode });
    this.log(inv, { rung, rateBps }, null, "rejected", `Rung ${rung} rejected: ${reply.reasonCode}.`);
    if (STOP_CODES.includes(reply.reasonCode)) {
      return { kind: "hold_to_due", reason: `The buyer agent stopped the ladder: ${reply.reasonCode}.` };
    }
    return "continue";
  }

  private log(inv: SupplierInvoice, snapshot: unknown, proposal: unknown, outcome: "auto_apply" | "needs_approval" | "rejected", reason: string, reasonCode?: string, priv?: unknown) {
    this.d.store.append({ actor: "supplier_agent", invoiceId: inv.id, snapshot, proposal, outcome, reason, reasonCode, private: priv }, this.now());
  }
}

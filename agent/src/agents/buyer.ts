import { z } from "zod";
import {
  allocate,
  evaluateOffer,
  type Allocation,
  type BuyerPolicy,
  type Candidate,
  type Domain,
  type Obligation,
  type ReasonCode,
} from "../core/index.js";
import {
  offerFromPayload,
  offerHashOf,
  signAccept,
  signReject,
  verifyMessage,
  type NegotiateReply,
  type OfferMsg,
} from "../protocol/index.js";
import { WalletError, type Address, type SignatureVerifier, type WalletAdapter } from "../wallets/types.js";
import { SETTLE_EARLY_FRAGMENT, type ChainReader } from "./chain.js";
import { ModelUnavailableError, ProposalInvalidError, type AgentModel } from "./model.js";
import { DecisionStore } from "./store.js";

/**
 * The buyer agent (CLAUDE.md 8.3). Its allocator is the star: a cash-constrained selection across many offers with a
 * day-by-day cash path check. Private: the hurdle, the floor and the caps never leave this process. A reject carries a
 * reason code only. The model may raise risk flags; code confirms each against the snapshot (8.3, 8.5).
 */

export class ProtocolError extends Error {
  constructor(
    readonly code: "UNKNOWN_SENDER" | "WRONG_SIGNER" | "BAD_SIGNATURE" | "SUPPLIER_MISMATCH" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

/** Flags the model may raise. Code can confirm each one from data it holds; anything else is ignored. */
export const FLAGS = ["new_payout_address", "amount_anomaly"] as const;
export const riskProposalSchema = z.strictObject({
  risk_flags: z
    .array(z.strictObject({ invoice_id: z.string().max(80), flag: z.enum(FLAGS), evidence_ref: z.string().max(40) }))
    .max(40),
  summary: z.string().max(400),
});
export type RiskProposal = z.infer<typeof riskProposalSchema>;

export interface InvoiceFacts {
  /** True when the supplier's payout address differs from earlier invoices (from the ledger). */
  newPayoutAddress?: boolean;
  /** Mean face of earlier invoices from this supplier, if any. */
  historicalMeanFace?: bigint;
}

export interface BuyerDeps {
  wallet: WalletAdapter;
  domain: Domain;
  model: AgentModel;
  policy: BuyerPolicy;
  store: DecisionStore;
  chain: ChainReader;
  invoiceBook: Address;
  verifier: SignatureVerifier;
  /** Private ledger lookups used to confirm model flags. */
  facts?: (invoiceId: string) => InvoiceFacts;
  now?: () => number;
}

interface HeldOffer {
  msg: OfferMsg;
  supplier: Address;
  face: bigint;
  dueSec: bigint;
}

export class BuyerAgent {
  private readonly now: () => number;
  /** Latest offer per invoice, for plan() and /accept. */
  private readonly offers = new Map<string, HeldOffer>();
  /** Offer nonces seen in this process (the contract enforces the same rule on chain). */
  private readonly seenNonces = new Set<string>();
  /** Items waiting for a person, with the reason code. Shown on /buyer/approvals. */
  readonly needsApproval = new Map<string, { reasonCode: string; reason: string }>();

  constructor(private readonly d: BuyerDeps) {
    this.now = d.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * POST /negotiate. Validates the sender, evaluates the offer with deterministic code, and answers accept or reject.
   * On accept it settles through the wallet first, so the supplier never sees an accept without a settlement attempt.
   */
  async handleOffer(msg: OfferMsg): Promise<NegotiateReply> {
    const nowSec = this.now();
    const id = msg.invoiceId as `0x${string}`;
    const onchain = await this.d.chain.invoice(id);
    if (!onchain) throw new ProtocolError("NOT_FOUND", "That invoice is not registered on chain.");
    if (onchain.buyer.toLowerCase() !== (await this.d.wallet.address()).toLowerCase()) {
      throw new ProtocolError("NOT_FOUND", "That invoice is not addressed to this buyer.");
    }
    // Only the invoice's own supplier may offer (the contract enforces the same on chain).
    if (msg.from.toLowerCase() !== onchain.supplier.toLowerCase()) {
      throw new ProtocolError("SUPPLIER_MISMATCH", "The offer was not sent by the invoice's supplier.");
    }
    const verified = await verifyMessage(this.d.verifier, this.d.domain, msg, onchain.supplier);
    if (!verified.ok) throw new ProtocolError(verified.failure, `The offer signature is not valid (${verified.failure}).`);

    const nonceKey = `${onchain.supplier.toLowerCase()}:${msg.offer.nonce}`;
    const replayed = this.seenNonces.has(nonceKey) || (await this.d.chain.offerNonceUsed(onchain.supplier, BigInt(msg.offer.nonce)));
    if (replayed) return this.reject(msg, "NOT_ELIGIBLE", nowSec, "The offer nonce was already used.");
    this.seenNonces.add(nonceKey);

    const candidate: Candidate = {
      id,
      face: onchain.amount,
      dueSec: onchain.dueDate,
      status: onchain.status === "approved" ? "approved" : onchain.status === "disputed" ? "disputed" : onchain.status === "registered" ? "registered" : "settled",
      offerRateBps: msg.offer.rateBps,
      offerExpirySec: BigInt(msg.offer.expiry),
    };
    this.offers.set(id, { msg, supplier: onchain.supplier, face: onchain.amount, dueSec: onchain.dueDate });

    const ev = evaluateOffer(this.d.policy, candidate, BigInt(nowSec));
    if (!ev.ok) {
      const outcome = ev.reason === "NEEDS_HUMAN_APPROVAL" ? "needs_approval" : "rejected";
      this.log(id, { rung: msg.rung, rateBps: msg.offer.rateBps }, null, outcome, ev.detail, ev.reason === "NEEDS_HUMAN_APPROVAL" ? ev.reason : undefined);
      if (ev.reason === "NEEDS_HUMAN_APPROVAL") this.needsApproval.set(id, { reasonCode: ev.reason, reason: ev.detail });
      return this.reject(msg, ev.reason, nowSec);
    }

    const decision = this.log(id, { rung: msg.rung, rateBps: msg.offer.rateBps }, null, "auto_apply", `Accepted rung ${msg.rung} at ${msg.offer.rateBps} bps: eligible and at or above the hurdle.`);
    try {
      await this.settle(msg, decision.hash);
    } catch (e) {
      if (e instanceof WalletError) {
        // No autonomous action on a wallet failure and no other wallet: wait for a person (spec 5.6).
        const reason = e.hint ? `${e.message} ${e.hint}` : e.message;
        this.log(id, { rung: msg.rung }, null, "needs_approval", reason, e.code);
        this.needsApproval.set(id, { reasonCode: e.code, reason });
        return this.reject(msg, "NEEDS_HUMAN_APPROVAL", nowSec);
      }
      throw e;
    }
    this.needsApproval.delete(id);
    return signAccept(this.d.wallet, this.d.domain, { invoiceId: id, rung: msg.rung, offerHash: offerHashOf(this.d.domain, msg.offer), ts: nowSec });
  }

  /** POST /plan: run the allocator over every held offer and the buyer's obligations. */
  async plan(cash: bigint, obligations: readonly Obligation[], spentToday = 0n): Promise<{ allocation: Allocation; flags: RiskProposal["risk_flags"] }> {
    const nowSec = BigInt(this.now());
    const candidates: Candidate[] = [];
    for (const [id, h] of this.offers) {
      const onchain = await this.d.chain.invoice(id as `0x${string}`);
      if (!onchain) continue;
      candidates.push({
        id,
        face: h.face,
        dueSec: h.dueSec,
        status: onchain.status === "approved" ? "approved" : onchain.status === "disputed" ? "disputed" : onchain.status === "registered" ? "registered" : "settled",
        offerRateBps: h.msg.offer.rateBps,
        offerExpirySec: BigInt(h.msg.offer.expiry),
      });
    }

    // The model can only remove an invoice from eligibility by raising a flag that code confirms.
    const confirmed = await this.confirmedFlags(candidates);
    for (const c of candidates) if (confirmed.some((f) => f.invoice_id === c.id)) c.reputationBlocked = true;

    const allocation = allocate({ nowSec, cash, policy: this.d.policy, obligations, candidates, spentToday });
    this.d.store.append(
      {
        actor: "buyer_agent",
        invoiceId: "plan",
        snapshot: { cash, obligations: obligations.length, candidates: candidates.map((c) => ({ id: c.id, face: c.face, rateBps: c.offerRateBps })) },
        proposal: { flags: confirmed },
        outcome: allocation.ids.length ? "auto_apply" : "rejected",
        reason: allocation.explanation,
      },
      Number(nowSec),
    );
    return { allocation, flags: confirmed };
  }

  /** POST /plan/execute: settle each chosen invoice, one by one. Anything above human_above was already held back. */
  async executePlan(allocation: Allocation): Promise<Array<{ id: string; txHash?: string; transactionId?: string }>> {
    const out: Array<{ id: string; txHash?: string; transactionId?: string }> = [];
    for (const item of allocation.items) {
      const held = this.offers.get(item.id);
      if (!held) continue;
      const decision = this.log(item.id, { rateBps: item.rateBps, discount: item.discount }, null, "auto_apply", allocation.explanation);
      const r = await this.settle(held.msg, decision.hash);
      out.push({ id: item.id, txHash: r.txHash, transactionId: r.transactionId });
    }
    return out;
  }

  private async confirmedFlags(candidates: readonly Candidate[]): Promise<RiskProposal["risk_flags"]> {
    if (candidates.length === 0) return [];
    const snapshot = { invoices: candidates.map((c) => ({ id: c.id, face: c.face, rateBps: c.offerRateBps })), allowedFlags: FLAGS };
    let proposal: RiskProposal;
    try {
      proposal = await this.d.model.propose({
        role: "buyer",
        task: "List qualitative risk flags for these invoices, each with an evidence_ref. You cannot change numbers.",
        snapshot,
        schema: riskProposalSchema,
      });
    } catch (e) {
      // Fail closed on the qualitative layer only: the deterministic allocator still runs, but we record why the flags are missing.
      const code = e instanceof ModelUnavailableError || e instanceof ProposalInvalidError ? e.code : "MODEL_ERROR";
      this.log("plan", snapshot, null, "needs_approval", (e as Error).message, code);
      if (e instanceof ModelUnavailableError) throw e; // nothing is auto-settled on a degraded path (spec 8.5 #6)
      return [];
    }
    const ids = new Set(candidates.map((c) => c.id));
    return proposal.risk_flags.filter((f) => ids.has(f.invoice_id) && this.confirm(f.flag, candidates.find((c) => c.id === f.invoice_id)!));
  }

  /** Code confirms a flag from its own records; the model's say-so is not evidence. */
  private confirm(flag: (typeof FLAGS)[number], c: Candidate): boolean {
    const facts = this.d.facts?.(c.id);
    if (!facts) return false;
    if (flag === "new_payout_address") return facts.newPayoutAddress === true;
    if (flag === "amount_anomaly") return facts.historicalMeanFace !== undefined && c.face > facts.historicalMeanFace * 3n;
    return false;
  }

  private async settle(msg: OfferMsg, decisionHash: `0x${string}`) {
    return this.d.wallet.execute({
      to: this.d.invoiceBook,
      abi: SETTLE_EARLY_FRAGMENT,
      fn: "settleEarly",
      args: [msg.invoiceId, offerFromPayload(msg.offer), msg.offerSig, decisionHash],
      // Same inputs, same key: a restart or a retry cannot settle twice.
      idempotencyKey: `settle:${msg.invoiceId}:${msg.offer.nonce}`.slice(0, 120),
    });
  }

  private async reject(msg: OfferMsg, reasonCode: ReasonCode, ts: number, detail?: string): Promise<NegotiateReply> {
    if (detail) this.log(msg.invoiceId, { rung: msg.rung }, null, "rejected", detail);
    return signReject(this.d.wallet, this.d.domain, { invoiceId: msg.invoiceId as `0x${string}`, rung: msg.rung, reasonCode, ts });
  }

  private log(invoiceId: string, snapshot: unknown, proposal: unknown, outcome: "auto_apply" | "needs_approval" | "rejected", reason: string, reasonCode?: string) {
    return this.d.store.append({ actor: "buyer_agent", invoiceId, snapshot, proposal, outcome, reason, reasonCode }, this.now());
  }
}

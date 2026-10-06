import { z } from "zod";
import {
  allocate,
  evaluateOffer,
  fitsCashPath,
  priceOffer,
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

/** What the buyer holds right now: the real USDC balance and its own calendar of payments (spec 8.3 and 3.2 step 5). */
export interface Treasury {
  cash: bigint;
  obligations: readonly Obligation[];
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
  /**
   * Read before every accept. The liquidity floor and the cash path are checked against it, so an offer that clears the
   * hurdle but would breach the floor is rejected. If it cannot be read, nothing is accepted (fail closed).
   */
  treasury: () => Promise<Treasury>;
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
  /** Answers already given, so a retried offer (a timeout, a restart of the sender) gets the same answer and settles once. */
  private readonly replies = new Map<string, NegotiateReply>();
  /** Net + fee paid early so far on the current UTC day, against the daily cap. */
  private spent = { day: -1, amount: 0n };
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

    const replyKey = `${id}:${msg.rung}:${msg.offer.nonce}`;
    const cached = this.replies.get(replyKey);
    if (cached) return cached;

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
      return this.remember(replyKey, await this.reject(msg, ev.reason, nowSec));
    }

    // Liquidity: the offer must fit the cash path above the floor, with obligations and the daily cap (spec 3.2 step 5).
    const fit = await this.fitsCash(candidate, nowSec);
    if (fit.kind === "unavailable") {
      this.seenNonces.delete(nonceKey); // nothing was decided, so the same offer may be sent again
      this.log(id, { rung: msg.rung }, null, "needs_approval", fit.reason, "TREASURY_UNAVAILABLE");
      this.needsApproval.set(id, { reasonCode: "TREASURY_UNAVAILABLE", reason: fit.reason });
      return this.reject(msg, "NEEDS_HUMAN_APPROVAL", nowSec);
    }
    if (fit.kind === "no") {
      this.log(id, { rung: msg.rung, rateBps: msg.offer.rateBps }, null, "rejected", fit.reason, "LIQUIDITY_FLOOR");
      return this.remember(replyKey, await this.reject(msg, "LIQUIDITY_FLOOR", nowSec));
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
    this.addSpent(candidate, nowSec);
    return this.remember(replyKey, await signAccept(this.d.wallet, this.d.domain, { invoiceId: id, rung: msg.rung, offerHash: offerHashOf(this.d.domain, msg.offer), ts: nowSec }));
  }

  private remember(key: string, reply: NegotiateReply): NegotiateReply {
    this.replies.set(key, reply);
    return reply;
  }

  private spentToday(nowSec: number): bigint {
    const day = Math.floor(nowSec / 86_400);
    if (this.spent.day !== day) this.spent = { day, amount: 0n };
    return this.spent.amount;
  }

  private addSpent(c: Candidate, nowSec: number) {
    const outflow = priceOffer(c.face, c.offerRateBps, c.dueSec - BigInt(nowSec), this.d.policy.feeBps).outflow;
    this.spentToday(nowSec);
    this.spent.amount += outflow;
  }

  /** Is this offer part of a plan that keeps the cash path above the floor? Uses the real balance. */
  private async fitsCash(c: Candidate, nowSec: number): Promise<{ kind: "ok" } | { kind: "no"; reason: string } | { kind: "unavailable"; reason: string }> {
    let t: Treasury;
    try {
      t = await this.d.treasury();
    } catch (e) {
      return { kind: "unavailable", reason: `The treasury could not be read, so nothing is accepted: ${(e as Error).message}` };
    }
    const ok = fitsCashPath({ nowSec: BigInt(nowSec), cash: t.cash, policy: this.d.policy, obligations: t.obligations, candidates: [c], spentToday: this.spentToday(nowSec) }, c.id);
    return ok ? { kind: "ok" } : { kind: "no", reason: "Accepting would take the cash path under the liquidity floor, or over the daily cap." };
  }

  /**
   * POST /accept/:invoiceId: accept the current rung now, if it is still eligible. Same checks and the same settlement
   * call (same idempotency key) as handleOffer, without the replay check, because the offer was already received.
   */
  async acceptHeld(invoiceId: string): Promise<{ settled: boolean; reasonCode?: ReasonCode; txHash?: string; transactionId?: string }> {
    const held = this.offers.get(invoiceId);
    if (!held) throw new ProtocolError("NOT_FOUND", "No offer is held for that invoice.");
    const onchain = await this.d.chain.invoice(invoiceId as `0x${string}`);
    if (!onchain) throw new ProtocolError("NOT_FOUND", "That invoice is not registered on chain.");
    const candidate: Candidate = {
      id: invoiceId,
      face: held.face,
      dueSec: held.dueSec,
      status: onchain.status === "approved" ? "approved" : onchain.status === "disputed" ? "disputed" : onchain.status === "registered" ? "registered" : "settled",
      offerRateBps: held.msg.offer.rateBps,
      offerExpirySec: BigInt(held.msg.offer.expiry),
    };
    const ev = evaluateOffer(this.d.policy, candidate, BigInt(this.now()));
    if (!ev.ok) return { settled: false, reasonCode: ev.reason };
    const fit = await this.fitsCash(candidate, this.now());
    if (fit.kind !== "ok") {
      this.log(invoiceId, { rateBps: held.msg.offer.rateBps }, null, fit.kind === "no" ? "rejected" : "needs_approval", fit.reason, fit.kind === "no" ? "LIQUIDITY_FLOOR" : "TREASURY_UNAVAILABLE");
      return { settled: false, reasonCode: fit.kind === "no" ? "LIQUIDITY_FLOOR" : "NEEDS_HUMAN_APPROVAL" };
    }
    const decision = this.log(invoiceId, { rateBps: held.msg.offer.rateBps }, null, "auto_apply", "Accepted the held offer on request.");
    const r = await this.settle(held.msg, decision.hash);
    this.addSpent(candidate, this.now());
    this.needsApproval.delete(invoiceId);
    return { settled: true, txHash: r.txHash, transactionId: r.transactionId };
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

    const allocation = allocate({ nowSec, cash, policy: this.d.policy, obligations, candidates, spentToday: spentToday + this.spentToday(Number(nowSec)) });
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
      this.spentToday(this.now());
      this.spent.amount += item.outflow;
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

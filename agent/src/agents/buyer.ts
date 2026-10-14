import { z } from "zod";
import {
  allocate,
  decideBuyerOffer,
  evaluateExposure,
  exposureOf,
  priceOffer,
  type Allocation,
  type BuyerDecision,
  type BuyerDecisionInput,
  type BuyerPolicy,
  type Candidate,
  type Domain,
  type ExposureInputs,
  type ExposurePolicy,
  type InvoiceEvent,
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

/**
 * Where the buyer gets its credit limit and the history behind it (SRS FR-05). Both reads may throw; a throw is "unavailable"
 * and the buyer accepts nothing until it can read them. `policy()` returns null when the owner has not set a limit: then no
 * exposure check is made and none is claimed.
 */
export interface ExposureSource {
  policy(): Promise<ExposurePolicy | null>;
  /** The invoices between this buyer and one supplier, from indexed chain events. */
  events(supplier: Address): Promise<readonly InvoiceEvent[]>;
}

/** What a log entry says about an exposure check: the policy version and the on-chain evidence it rested on. No limits, no private amounts. */
export interface ExposureInfo {
  policyVersion: string;
  result: "ok" | "limit";
  evidence: Array<{ ref: string; kind: string; txHash?: string; logIndex?: number }>;
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
  /** The credit limit and history. Without it no exposure check is made. */
  exposure?: ExposureSource;
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
  /** Early payments this process has made, so two offers in a row cannot pass the limit while the indexer catches up. */
  private readonly paidEarly: Array<{ supplier: string; event: InvoiceEvent }> = [];
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

    // Gather every input, then let the pure decision function decide (SRS NFR-04). Unreadable inputs are never defaulted.
    const { input, decision: verdict, info, readErrors } = await this.decideOffer(candidate, onchain.supplier, nowSec);
    const where = { rung: msg.rung, rateBps: msg.offer.rateBps };
    const shown = (code: string) => ({ ...where, ...(info ? { exposure: info } : {}), result: { code } });
    if (verdict.result === "reject") {
      this.log(id, shown(verdict.code), null, "rejected", verdict.detail, verdict.code, this.privateOf(input, verdict));
      return this.remember(replyKey, await this.reject(msg, verdict.code, nowSec));
    }
    if (verdict.result === "needs_approval") {
      const reason = readErrors.length ? `${verdict.detail} (${readErrors.join("; ")})` : verdict.detail;
      this.log(id, shown(verdict.code), null, "needs_approval", reason, verdict.code, this.privateOf(input, verdict));
      this.needsApproval.set(id, { reasonCode: verdict.code, reason });
      if (verdict.code === "NEEDS_HUMAN_APPROVAL") return this.remember(replyKey, await this.reject(msg, "NEEDS_HUMAN_APPROVAL", nowSec));
      this.seenNonces.delete(nonceKey); // nothing was decided, so the same offer may be sent again
      return this.reject(msg, "NEEDS_HUMAN_APPROVAL", nowSec);
    }

    const decision = this.log(id, shown("ACCEPT"), null, "auto_apply", `Accepted rung ${msg.rung} at ${msg.offer.rateBps} bps: eligible, inside the credit limit and above the liquidity floor.`, undefined, this.privateOf(input, verdict));
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
    this.recordPaid(candidate, onchain.supplier, nowSec);
    return this.remember(replyKey, await signAccept(this.d.wallet, this.d.domain, { invoiceId: id, rung: msg.rung, offerHash: offerHashOf(this.d.domain, msg.offer), ts: nowSec }));
  }

  /** Remember a payment this process just made, until the indexer shows it. */
  private recordPaid(c: Candidate, supplier: Address, nowSec: number) {
    const p = priceOffer(c.face, c.offerRateBps, c.dueSec - BigInt(nowSec), this.d.policy.feeBps);
    this.paidEarly.push({ supplier: supplier.toLowerCase(), event: { invoiceId: c.id, state: "settled_early", face: c.face, outflow: p.outflow, dueSec: c.dueSec } });
  }

  /**
   * Is this payment inside the limit set for this supplier? `off`: no limit is set (nothing is claimed). `unavailable`: the policy or
   * the history could not be read, so nothing is accepted. The result carries the policy version and on-chain evidence for the log.
   */
  private async checkExposure(c: Candidate, nowSec: number, supplier: Address): Promise<{ kind: "off" } | { kind: "ok"; info: ExposureInfo } | { kind: "limit"; info: ExposureInfo } | { kind: "unavailable"; reason: string }> {
    const src = this.d.exposure;
    if (!src) return { kind: "off" };
    let policy: ExposurePolicy | null;
    let events: readonly InvoiceEvent[];
    try {
      policy = await src.policy();
      if (!policy) return { kind: "off" };
      events = await src.events(supplier);
    } catch (e) {
      return { kind: "unavailable", reason: `The credit limit or its history could not be read, so nothing is accepted: ${(e as Error).message}` };
    }
    const local = this.paidEarly.filter((p) => p.supplier === supplier.toLowerCase()).map((p) => p.event);
    const outflow = priceOffer(c.face, c.offerRateBps, c.dueSec - BigInt(nowSec), this.d.policy.feeBps).outflow;
    // Indexed events come first, so a payment that has been indexed wins over this process's own record of it.
    const d = evaluateExposure({ side: "buyer", nowSec: BigInt(nowSec), newExposure: outflow, events: [...events, ...local], policy });
    if (d.kind === "unavailable") return { kind: "unavailable", reason: "The history needed for the credit limit is unavailable, so nothing is accepted." };
    const info: ExposureInfo = {
      policyVersion: policy.version,
      result: d.ok ? "ok" : "limit",
      evidence: d.evidence.map((e) => ({ ref: e.ref, kind: e.kind, ...(e.txHash ? { txHash: e.txHash } : {}), ...(e.logIndex !== undefined ? { logIndex: e.logIndex } : {}) })),
    };
    return d.ok ? { kind: "ok", info } : { kind: "limit", info };
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

  /**
   * Read every input the decision needs, then call the pure `decideBuyerOffer`. An input that cannot be read is passed as
   * unreadable, so the answer is "needs a person", never a favourable default. `info` is the public part of the credit check:
   * the policy version and the on-chain evidence, never a limit.
   */
  private async decideOffer(c: Candidate, supplier: Address, nowSec: number) {
    const readErrors: string[] = [];
    let treasury: BuyerDecisionInput["treasury"] = null;
    try {
      const t = await this.d.treasury();
      treasury = { cash: t.cash, obligations: t.obligations };
    } catch (e) {
      readErrors.push(`The treasury could not be read: ${(e as Error).message}`);
    }
    let exposure: ExposureInputs = { kind: "off" };
    if (this.d.exposure) {
      try {
        const policy = await this.d.exposure.policy();
        if (policy) {
          const events = await this.d.exposure.events(supplier);
          const local = this.paidEarly.filter((p) => p.supplier === supplier.toLowerCase()).map((p) => p.event);
          // Indexed events come first, so a payment that has been indexed wins over this process's own record of it.
          exposure = { kind: "on", policy, events: [...events, ...local] };
        }
      } catch (e) {
        readErrors.push(`The credit limit or its history could not be read: ${(e as Error).message}`);
        exposure = { kind: "unreadable" };
      }
    }
    const input: BuyerDecisionInput = { nowSec: BigInt(nowSec), candidate: c, policy: this.d.policy, treasury, spentToday: this.spentToday(nowSec), exposure };
    const decision = decideBuyerOffer(input);
    const credit = decision.steps[1]!.result;
    const d = exposure.kind === "on" && (credit === "passed" || credit === "failed") ? exposureOf(input) : null;
    const info: ExposureInfo | undefined =
      d && d.kind === "decided" && exposure.kind === "on"
        ? { policyVersion: exposure.policy.version, result: d.ok ? "ok" : "limit", evidence: d.evidence.map((e) => ({ ref: e.ref, kind: e.kind, ...(e.txHash ? { txHash: e.txHash } : {}), ...(e.logIndex !== undefined ? { logIndex: e.logIndex } : {}) })) }
        : undefined;
    return { input, decision, info, readErrors };
  }

  /** Everything the decision used, for the agent's own file. The public log only gets a salted commitment to it. */
  private privateOf(input: BuyerDecisionInput, decision: BuyerDecision) {
    return { ...input, decision: decision.result === "accept" ? "ACCEPT" : decision.code };
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
    const nowSec = this.now();
    const { input, decision: verdict, info, readErrors } = await this.decideOffer(candidate, held.supplier, nowSec);
    const where = { rateBps: held.msg.offer.rateBps };
    const shown = (code: string) => ({ ...where, ...(info ? { exposure: info } : {}), result: { code } });
    // An offer that is no longer eligible (expired, disputed, due) is simply refused; the decision log records only real decisions.
    if (verdict.steps[0]!.result === "failed") return { settled: false, reasonCode: verdict.result === "accept" ? undefined : verdict.code };
    if (verdict.result === "reject") {
      this.log(invoiceId, shown(verdict.code), null, "rejected", verdict.detail, verdict.code, this.privateOf(input, verdict));
      return { settled: false, reasonCode: verdict.code };
    }
    if (verdict.result === "needs_approval") {
      const reason = readErrors.length ? `${verdict.detail} (${readErrors.join("; ")})` : verdict.detail;
      this.log(invoiceId, shown(verdict.code), null, "needs_approval", reason, verdict.code, this.privateOf(input, verdict));
      return { settled: false, reasonCode: "NEEDS_HUMAN_APPROVAL" };
    }
    const decision = this.log(invoiceId, shown("ACCEPT"), null, "auto_apply", "Accepted the held offer on request.", undefined, this.privateOf(input, verdict));
    const r = await this.settle(held.msg, decision.hash);
    this.addSpent(candidate, this.now());
    this.recordPaid(candidate, held.supplier, this.now());
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
      const candidate: Candidate = { id: item.id, face: held.face, dueSec: held.dueSec, status: "approved", offerRateBps: held.msg.offer.rateBps, offerExpirySec: BigInt(held.msg.offer.expiry) };
      const ex = await this.checkExposure(candidate, this.now(), held.supplier);
      if (ex.kind === "limit" || ex.kind === "unavailable") {
        // The allocator knows cash, not credit limits: a payment the limit forbids is skipped here, with the reason in the log.
        const limit = ex.kind === "limit";
        this.log(item.id, { rateBps: item.rateBps, ...(limit ? { exposure: ex.info } : {}) }, null, limit ? "rejected" : "needs_approval", limit ? "The payment would take the exposure to this supplier past its allowed limit." : ex.reason, limit ? "EXPOSURE_LIMIT" : "EVIDENCE_UNAVAILABLE");
        continue;
      }
      const decision = this.log(item.id, { rateBps: item.rateBps, discount: item.discount, ...(ex.kind === "ok" ? { exposure: ex.info } : {}) }, null, "auto_apply", allocation.explanation);
      const r = await this.settle(held.msg, decision.hash);
      this.spentToday(this.now());
      this.spent.amount += item.outflow;
      this.recordPaid(candidate, held.supplier, this.now());
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

  private log(invoiceId: string, snapshot: unknown, proposal: unknown, outcome: "auto_apply" | "needs_approval" | "rejected", reason: string, reasonCode?: string, priv?: unknown) {
    return this.d.store.append({ actor: "buyer_agent", invoiceId, snapshot, proposal, outcome, reason, reasonCode, private: priv }, this.now());
  }
}

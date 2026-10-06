import { keccak256, toHex, type Hex } from "viem";
import { offerDigest, type Domain } from "../core/index.js";
import type { SignatureVerifier, WalletAdapter } from "../wallets/types.js";
import type { AcceptMsg, OfferMsg, OfferPayload, RejectMsg, WithdrawMsg } from "./schemas.js";
import type { ReasonCode } from "../core/index.js";

/**
 * Signed envelope for accept, reject and withdraw: EIP-712 over
 * MisthosMessage(string kind,bytes32 invoiceId,uint32 rung,bytes32 ref,address from,uint64 ts).
 * `ref` ties the signature to the payload: the offer digest for accept, keccak256(reasonCode) for reject, zero for
 * withdraw. The spec (8.6) says "signed with EIP-712 by the sender's agent wallet" without exact types; these are ours
 * (recorded in docs/DECISIONS.md).
 *
 * An OfferMsg is authenticated by its offerSig, which is the same EIP-712 EarlyPayOffer signature the contract verifies,
 * so the supplier signs once.
 */
export const MESSAGE_TYPES = {
  MisthosMessage: [
    { name: "kind", type: "string" },
    { name: "invoiceId", type: "bytes32" },
    { name: "rung", type: "uint32" },
    { name: "ref", type: "bytes32" },
    { name: "from", type: "address" },
    { name: "ts", type: "uint64" },
  ],
} as const;

const ZERO32 = ("0x" + "00".repeat(32)) as Hex;

export function messageTypedData(
  d: Domain,
  m: { kind: "accept" | "reject" | "withdraw"; invoiceId: Hex; rung: number; ref: Hex; from: `0x${string}`; ts: number },
) {
  return {
    domain: d,
    types: MESSAGE_TYPES,
    primaryType: "MisthosMessage" as const,
    message: { kind: m.kind, invoiceId: m.invoiceId, rung: m.rung, ref: m.ref, from: m.from, ts: BigInt(m.ts) },
  };
}

export function offerFromPayload(p: OfferPayload) {
  return { invoiceId: p.invoiceId, rateBps: p.rateBps, expiry: BigInt(p.expiry), nonce: BigInt(p.nonce) };
}

export function offerHashOf(d: Domain, p: OfferPayload): Hex {
  return offerDigest(d, offerFromPayload(p));
}

export const reasonRef = (code: ReasonCode): Hex => keccak256(toHex(code));

export async function signAccept(
  wallet: WalletAdapter,
  d: Domain,
  args: { invoiceId: Hex; rung: number; offerHash: Hex; ts: number },
): Promise<AcceptMsg> {
  const from = await wallet.address();
  const sig = await wallet.signTypedData(messageTypedData(d, { kind: "accept", from, ref: args.offerHash, ...args }));
  return { v: 1, type: "accept", invoiceId: args.invoiceId, rung: args.rung, offerHash: args.offerHash, from, ts: args.ts, sig };
}

export async function signReject(
  wallet: WalletAdapter,
  d: Domain,
  args: { invoiceId: Hex; rung: number; reasonCode: ReasonCode; ts: number },
): Promise<RejectMsg> {
  const from = await wallet.address();
  const sig = await wallet.signTypedData(
    messageTypedData(d, { kind: "reject", from, ref: reasonRef(args.reasonCode), invoiceId: args.invoiceId, rung: args.rung, ts: args.ts }),
  );
  return { v: 1, type: "reject", invoiceId: args.invoiceId, rung: args.rung, reasonCode: args.reasonCode, from, ts: args.ts, sig };
}

export async function signWithdraw(wallet: WalletAdapter, d: Domain, args: { invoiceId: Hex; ts: number }): Promise<WithdrawMsg> {
  const from = await wallet.address();
  const sig = await wallet.signTypedData(
    messageTypedData(d, { kind: "withdraw", from, ref: ZERO32, invoiceId: args.invoiceId, rung: 0, ts: args.ts }),
  );
  return { v: 1, type: "withdraw", invoiceId: args.invoiceId, from, ts: args.ts, sig };
}

export type VerifyFailure = "WRONG_SIGNER" | "UNKNOWN_SENDER" | "BAD_SIGNATURE";

/**
 * Check the sender of a message. `knownAgent` is the wallet address this process was configured to talk to; anything
 * else is rejected before any decision is made (spec 8.5 #8: peer messages are untrusted data).
 */
export async function verifyMessage(
  verify: SignatureVerifier,
  d: Domain,
  msg: OfferMsg | AcceptMsg | RejectMsg | WithdrawMsg,
  knownAgent: `0x${string}`,
): Promise<{ ok: true } | { ok: false; failure: VerifyFailure }> {
  if (msg.from.toLowerCase() !== knownAgent.toLowerCase()) return { ok: false, failure: "UNKNOWN_SENDER" };
  try {
    let ok: boolean;
    if (msg.type === "offer") {
      const td = { domain: d, types: { EarlyPayOffer: [
        { name: "invoiceId", type: "bytes32" },
        { name: "rateBps", type: "uint16" },
        { name: "expiry", type: "uint64" },
        { name: "nonce", type: "uint256" },
      ] }, primaryType: "EarlyPayOffer" as const, message: offerFromPayload(msg.offer) };
      ok = await verify(td, msg.offerSig as Hex, msg.from);
    } else {
      const ref = msg.type === "accept" ? msg.offerHash : msg.type === "reject" ? reasonRef(msg.reasonCode) : ZERO32;
      const rung = msg.type === "withdraw" ? 0 : msg.rung;
      const td = messageTypedData(d, { kind: msg.type, invoiceId: msg.invoiceId, rung, ref, from: msg.from, ts: msg.ts });
      ok = await verify(td, msg.sig as Hex, msg.from);
    }
    return ok ? { ok: true } : { ok: false, failure: "WRONG_SIGNER" };
  } catch {
    return { ok: false, failure: "BAD_SIGNATURE" };
  }
}

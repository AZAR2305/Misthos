import { z } from "zod";
import { REASON_CODES, MAX_RATE_BPS } from "../core/index.js";

/**
 * Negotiation messages (CLAUDE.md 8.6). Every schema is strict: unknown fields are rejected, so a peer cannot smuggle
 * extra data (or instructions) through a message. Free text never appears here (spec 8.5 #1 and #8).
 * Integers that can exceed 2^53 travel as decimal strings.
 */
const hex = (bytes: number) => z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`), `expected ${bytes} bytes of hex`);
export const addressSchema = hex(20).transform((v) => v.toLowerCase() as `0x${string}`);
export const bytes32Schema = hex(32).transform((v) => v.toLowerCase() as `0x${string}`);
export const signatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130,}$/, "expected a signature");
export const uintString = z.string().regex(/^\d{1,78}$/, "expected an unsigned integer string");
const rungSchema = z.number().int().min(0).max(1000);
const tsSchema = z.number().int().positive();

export const reasonCodeSchema = z.enum(REASON_CODES);

export const offerPayloadSchema = z.strictObject({
  invoiceId: bytes32Schema,
  rateBps: z.number().int().min(0).max(MAX_RATE_BPS),
  expiry: uintString,
  nonce: uintString,
});
export type OfferPayload = z.infer<typeof offerPayloadSchema>;

export const offerMsgSchema = z.strictObject({
  v: z.literal(1),
  type: z.literal("offer"),
  invoiceId: bytes32Schema,
  rung: rungSchema,
  offer: offerPayloadSchema,
  offerSig: signatureSchema,
  from: addressSchema,
  ts: tsSchema,
});

export const acceptMsgSchema = z.strictObject({
  v: z.literal(1),
  type: z.literal("accept"),
  invoiceId: bytes32Schema,
  rung: rungSchema,
  offerHash: bytes32Schema,
  from: addressSchema,
  ts: tsSchema,
  sig: signatureSchema,
});

export const rejectMsgSchema = z.strictObject({
  v: z.literal(1),
  type: z.literal("reject"),
  invoiceId: bytes32Schema,
  rung: rungSchema,
  reasonCode: reasonCodeSchema,
  from: addressSchema,
  ts: tsSchema,
  sig: signatureSchema,
});

export const withdrawMsgSchema = z.strictObject({
  v: z.literal(1),
  type: z.literal("withdraw"),
  invoiceId: bytes32Schema,
  from: addressSchema,
  ts: tsSchema,
  sig: signatureSchema,
});

export const messageSchema = z.discriminatedUnion("type", [
  offerMsgSchema,
  acceptMsgSchema,
  rejectMsgSchema,
  withdrawMsgSchema,
]);

export type OfferMsg = z.infer<typeof offerMsgSchema>;
export type AcceptMsg = z.infer<typeof acceptMsgSchema>;
export type RejectMsg = z.infer<typeof rejectMsgSchema>;
export type WithdrawMsg = z.infer<typeof withdrawMsgSchema>;
export type Message = z.infer<typeof messageSchema>;

/** What the buyer agent answers to an offer on POST /negotiate. */
export const negotiateReplySchema = z.discriminatedUnion("type", [acceptMsgSchema, rejectMsgSchema]);
export type NegotiateReply = z.infer<typeof negotiateReplySchema>;

/** Never put a model-written explanation or any hurdle value on the wire: this is the whole reject payload. */
export const FORBIDDEN_REJECT_KEYS = ["hurdle", "hurdleBps", "hurdleAprBps", "reserve"] as const;

import { z } from "zod";

/**
 * A signed early-pay offer packaged so a supplier can hand it to a buyer (copy, paste, QR) without a server. It carries the
 * exact EIP-712 EarlyPayOffer and its signature, which is what InvoiceBook.settleEarly verifies on chain, so the code is
 * safe to share: it can only be used by the buyer of that invoice, once, before it expires, at or below its signed rate.
 */
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const uintString = z.string().regex(/^\d{1,78}$/);

export const offerCodeSchema = z.strictObject({
  v: z.literal(1),
  chainId: z.number().int().positive(),
  book: address,
  supplier: address,
  offer: z.strictObject({
    invoiceId: hex32,
    rateBps: z.number().int().min(0).max(5000),
    expiry: uintString,
    nonce: uintString,
  }),
  sig: z.string().regex(/^0x[0-9a-fA-F]{130,}$/),
});
export type OfferCode = z.infer<typeof offerCodeSchema>;

const PREFIX = "misthos-offer-1:";

const toB64Url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

export function encodeOfferCode(code: OfferCode): string {
  return PREFIX + toB64Url(JSON.stringify(offerCodeSchema.parse(code)));
}

export type Decoded = { ok: true; value: OfferCode } | { ok: false; error: string };

/** Never throws: a pasted code is untrusted input. */
export function decodeOfferCode(text: string): Decoded {
  const t = text.trim();
  if (!t.startsWith(PREFIX)) return { ok: false, error: "That is not a Misthos offer code. It should start with “misthos-offer-1:”." };
  try {
    const parsed = offerCodeSchema.safeParse(JSON.parse(fromB64Url(t.slice(PREFIX.length))));
    if (!parsed.success) return { ok: false, error: "The offer code is damaged or incomplete. Ask the supplier to send it again." };
    return { ok: true, value: parsed.data };
  } catch {
    return { ok: false, error: "The offer code could not be read. Copy it again in full." };
  }
}

/** A single-use 128-bit nonce, like the supplier agent uses. */
export function randomNonce(): bigint {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return BigInt("0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join(""));
}

export function offerToContract(o: OfferCode["offer"]) {
  return { invoiceId: o.invoiceId as `0x${string}`, rateBps: o.rateBps, expiry: BigInt(o.expiry), nonce: BigInt(o.nonce) };
}

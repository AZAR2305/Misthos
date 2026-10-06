import { hashTypedData, recoverTypedDataAddress, type Hex } from "viem";

/**
 * EIP-712 payloads for InvoiceBook (CLAUDE.md 7.1 and 7.2). The types must match the contract's type strings
 * exactly; contract/test/InvoiceBook.t.sol rebuilds the digests from the same strings.
 */
export const INVOICE_TYPES = {
  Invoice: [
    { name: "supplier", type: "address" },
    { name: "buyer", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "dueDate", type: "uint64" },
    { name: "refHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const OFFER_TYPES = {
  EarlyPayOffer: [
    { name: "invoiceId", type: "bytes32" },
    { name: "rateBps", type: "uint16" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export type Domain = {
  name: "Misthos";
  version: "1";
  chainId: number;
  verifyingContract: `0x${string}`;
};

export function domain(chainId: number, verifyingContract: `0x${string}`): Domain {
  return { name: "Misthos", version: "1", chainId, verifyingContract };
}

export type InvoiceMsg = {
  supplier: `0x${string}`;
  buyer: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  dueDate: bigint;
  refHash: Hex;
  nonce: bigint;
};

export type OfferMsg = {
  invoiceId: Hex;
  rateBps: number;
  expiry: bigint;
  nonce: bigint;
};

export function invoiceTypedData(d: Domain, message: InvoiceMsg) {
  return { domain: d, types: INVOICE_TYPES, primaryType: "Invoice" as const, message };
}

export function offerTypedData(d: Domain, message: OfferMsg) {
  return { domain: d, types: OFFER_TYPES, primaryType: "EarlyPayOffer" as const, message };
}

/** The invoice id the contract computes: the EIP-712 digest of the Invoice. */
export function invoiceId(d: Domain, inv: InvoiceMsg): Hex {
  return hashTypedData(invoiceTypedData(d, inv));
}

export function offerDigest(d: Domain, offer: OfferMsg): Hex {
  return hashTypedData(offerTypedData(d, offer));
}

/** JSON string for `circle wallet sign typed-data '<json>'`. bigint becomes a decimal string, as EIP-712 JSON expects. */
export function typedDataJson(td: {
  domain: unknown;
  types: unknown;
  primaryType: string;
  message: unknown;
}): string {
  const types = { EIP712Domain: DOMAIN_TYPE, ...(td.types as Record<string, unknown>) };
  return JSON.stringify({ ...td, types }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

const DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

/** EOA check: who signed this typed data. For ERC-1271 wallets, call isValidSignature through a chain client instead. */
export async function recoverSigner(args: Parameters<typeof recoverTypedDataAddress>[0]): Promise<`0x${string}`> {
  return recoverTypedDataAddress(args);
}


/**
 * The attester signature on a decision-log entry (spec 8.4: "sign each entry with the attester key"). The agent wallet signs
 * the entry's hash together with its place in the chain, so the backend can check who wrote it and that nothing was
 * dropped or reordered. The domain is the same as for offers.
 */
export const DECISION_TYPES = {
  DecisionAttestation: [
    { name: "hash", type: "bytes32" },
    { name: "prevHash", type: "bytes32" },
    { name: "actor", type: "string" },
    { name: "seq", type: "uint64" },
  ],
} as const;

export function decisionTypedData(d: Domain, m: { hash: Hex; prevHash: Hex; actor: string; seq: number }) {
  return {
    domain: d,
    types: DECISION_TYPES,
    primaryType: "DecisionAttestation" as const,
    message: { hash: m.hash, prevHash: m.prevHash, actor: m.actor, seq: BigInt(m.seq) },
  };
}

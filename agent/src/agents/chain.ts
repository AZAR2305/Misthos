import { createPublicClient, http, parseAbi } from "viem";
import type { Address } from "../wallets/types.js";

/** Read-only view of InvoiceBook (CLAUDE.md 7). Real chain reads; there is no cached or invented state. */
export const INVOICE_BOOK_ABI = parseAbi([
  "function invoices(bytes32) view returns (address supplier, address buyer, address token, uint128 amount, uint64 dueDate, uint64 approvedAt, uint8 status)",
  "function usedOfferNonce(address, uint256) view returns (bool)",
]);

/** Write fragments for the wallet adapter (`abi` + `fn`). */
export const SETTLE_EARLY_FRAGMENT =
  "function settleEarly(bytes32 id, (bytes32 invoiceId, uint16 rateBps, uint64 expiry, uint256 nonce) offer, bytes sig, bytes32 decisionHash)";

const STATUS = ["none", "registered", "approved", "settled_early", "settled_due", "disputed"] as const;
export type OnChainStatus = (typeof STATUS)[number];

export interface OnChainInvoice {
  supplier: Address;
  buyer: Address;
  token: Address;
  amount: bigint;
  dueDate: bigint;
  approvedAt: bigint;
  status: OnChainStatus;
}

export interface ChainReader {
  invoice(id: `0x${string}`): Promise<OnChainInvoice | undefined>;
  offerNonceUsed(supplier: Address, nonce: bigint): Promise<boolean>;
}

export function viemChainReader(rpcUrl: string, book: Address): ChainReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async invoice(id) {
      const [supplier, buyer, token, amount, dueDate, approvedAt, status] = await client.readContract({
        address: book,
        abi: INVOICE_BOOK_ABI,
        functionName: "invoices",
        args: [id],
      });
      const s = STATUS[status] ?? "none";
      return s === "none" ? undefined : { supplier, buyer, token, amount, dueDate, approvedAt, status: s };
    },
    offerNonceUsed(supplier, nonce) {
      return client.readContract({ address: book, abi: INVOICE_BOOK_ABI, functionName: "usedOfferNonce", args: [supplier, nonce] });
    },
  };
}

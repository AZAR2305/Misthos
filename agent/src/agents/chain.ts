import { createPublicClient, http, parseAbi } from "viem";
import { ProtocolError } from "./buyer.js";
import type { Address } from "../wallets/types.js";

/** Read-only view of InvoiceBook (CLAUDE.md 7). Real chain reads; there is no cached or invented state. */
export const INVOICE_BOOK_ABI = parseAbi([
  "function invoices(bytes32) view returns (address supplier, address buyer, address token, uint128 amount, uint64 dueDate, uint64 approvedAt, uint8 status)",
  "function usedOfferNonce(address, uint256) view returns (bool)",
]);

/** Write fragments for the wallet adapter (`abi` + `fn`). */
/**
 * Agent wallets call settleEarlyFlat: Circle's CLI cannot encode a struct argument ("can't pack ABI parameter", found on the first real run),
 * so the offer travels as flat arguments. Same checks on chain as settleEarly.
 */
/**
 * Wraps a chain reader so that an unreachable RPC is a typed, public error (CHAIN_UNAVAILABLE) and not an opaque 500: no action is taken and the person
 * sees "chain unavailable". It never substitutes another RPC or a cached value.
 */
export function guardChain(reader: ChainReader): ChainReader {
  const guard = async <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof ProtocolError) throw e;
      throw new ProtocolError("CHAIN_UNAVAILABLE", `The chain is unavailable, so no action was taken (${(e as Error).message.split("\n")[0]}).`);
    }
  };
  return { invoice: (id) => guard(() => reader.invoice(id)), offerNonceUsed: (s, n) => guard(() => reader.offerNonceUsed(s, n)) };
}

export const SETTLE_EARLY_FRAGMENT =
  "function settleEarlyFlat(bytes32 id, uint16 rateBps, uint64 expiry, uint256 nonce, bytes sig, bytes32 decisionHash)";

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

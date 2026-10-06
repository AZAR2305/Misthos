import { createWalletClient, http, type Address, type Chain, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { INVOICE_BOOK_ABI, type InvoiceMsg } from "./shared";
import { JobError, type Handlers } from "./jobs";

/**
 * The relayer pays gas to submit registerInvoice for a supplier who has signed. registerInvoice is permissionless and
 * checks the supplier's signature on-chain, so the relayer can neither forge an invoice nor touch anyone's funds.
 * Spec 5.3 names a managed Circle wallet for this; the key-based relayer below is the smallest thing that works today.
 * VERIFY: swap in the Circle managed wallet adapter once a Circle API key exists.
 */
export interface Relayer {
  address: Address;
  registerInvoice(inv: InvoiceMsg, signature: Hex): Promise<Hex>;
}

/** VERIFY: Arc may fail eth_estimateGas (spec 5.5), so simulate first, then fall back to an explicit limit. */
const REGISTER_GAS_FALLBACK = 400_000n;

export function createViemRelayer(o: { privateKey: Hex; rpcUrl: string; chain: Chain; book: Address; publicClient: PublicClient }): Relayer {
  const account = privateKeyToAccount(o.privateKey);
  const wallet = createWalletClient({ account, chain: o.chain, transport: http(o.rpcUrl) });
  return {
    address: account.address,
    async registerInvoice(inv, signature) {
      const args = [inv, signature] as const;
      // Simulating surfaces the contract's own revert name (BadSignature, AlreadyRegistered, ...) instead of a gas error.
      await o.publicClient.simulateContract({ account, address: o.book, abi: INVOICE_BOOK_ABI, functionName: "registerInvoice", args });
      let gas: bigint;
      try {
        gas = await o.publicClient.estimateContractGas({ account, address: o.book, abi: INVOICE_BOOK_ABI, functionName: "registerInvoice", args });
        gas = (gas * 12n) / 10n;
      } catch {
        gas = REGISTER_GAS_FALLBACK;
      }
      return wallet.writeContract({ address: o.book, abi: INVOICE_BOOK_ABI, functionName: "registerInvoice", args, gas });
    },
  };
}

export interface RegisterPayload {
  invoice: { supplier: Address; buyer: Address; token: Address; amount: string; dueDate: string; refHash: Hex; nonce: string };
  signature: Hex;
  invoiceId: Hex;
}

export const toInvoiceMsg = (p: RegisterPayload["invoice"]): InvoiceMsg => ({
  supplier: p.supplier,
  buyer: p.buyer,
  token: p.token,
  amount: BigInt(p.amount),
  dueDate: BigInt(p.dueDate),
  refHash: p.refHash,
  nonce: BigInt(p.nonce),
});

/** Job handlers for chain writes. Each one reads the chain first, so running it twice never sends twice. */
export function chainHandlers(o: { relayer: Relayer; publicClient: PublicClient; book: Address }): Handlers {
  return {
    register_invoice: async (p: RegisterPayload) => {
      const onChain = await o.publicClient.readContract({ address: o.book, abi: INVOICE_BOOK_ABI, functionName: "invoices", args: [p.invoiceId] });
      if (onChain[6] !== 0) return { alreadyRegistered: true };
      let hash: Hex;
      try {
        hash = await o.relayer.registerInvoice(toInvoiceMsg(p.invoice), p.signature);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A revert from the contract will not change on retry; a network error might.
        const revert = /BadSignature|AlreadyRegistered|TokenNotAllowed|BadParams|DuplicateInvoice|reverted/i.test(msg);
        throw new JobError(msg.split("\n")[0]!, revert ? "REVERTED" : "SEND_FAILED", !revert);
      }
      const receipt = await o.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new JobError(`transaction ${hash} reverted`, "REVERTED", false);
      return { txHash: hash, block: receipt.blockNumber.toString() };
    },
  };
}

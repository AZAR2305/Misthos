import { recoverTypedDataAddress, type Hex, type PublicClient } from "viem";

/** EIP-712 payload as every adapter and verifier sees it. */
export interface Eip712Payload {
  domain: Record<string, unknown>;
  types: Record<string, readonly { readonly name: string; readonly type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export type Address = `0x${string}`;

/** One call to a contract write function. `abi` is a human-readable fragment; `fn` is the function name in it. */
export interface ContractCall {
  to: Address;
  abi: string;
  fn: string;
  args: readonly unknown[];
  gas?: bigint;
  /** Retrying a call with the same key must not send twice (spec 6: chain writes are idempotent). */
  idempotencyKey?: string;
}

/**
 * Agent Wallets return a transaction id first and a hash once mined. `txHash` is set when the adapter has one.
 * VERIFY: the exact JSON the Circle CLI returns from `wallet execute` (spec Appendix A #6).
 */
export interface ExecuteResult {
  txHash?: Hex;
  transactionId?: string;
  raw: unknown;
}

/** Every wallet and Agent Stack call goes through this interface (CLAUDE.md 5.6). There is no mock and no fallback. */
export interface WalletAdapter {
  mode: "agent" | "managed";
  address(): Promise<Address>;
  /** 6-decimal minor units, read with ERC-20 balanceOf. */
  balance(token: "USDC" | "EURC"): Promise<bigint>;
  /** The signature is always verified locally before it is returned. */
  signTypedData(payload: Eip712Payload): Promise<Hex>;
  execute(call: ContractCall): Promise<ExecuteResult>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export type WalletErrorCode =
  | "SESSION_EXPIRED"
  | "RATE_LIMITED"
  | "CLI_ERROR"
  | "CLI_NOT_FOUND"
  | "TERMS_NOT_ACCEPTED"
  | "SIGNATURE_MISMATCH"
  | "BAD_OUTPUT"
  | "NOT_CONFIGURED"
  | "UNAVAILABLE";

/**
 * Typed wallet failure. On SESSION_EXPIRED, RATE_LIMITED or any CLI error the action is NOT retried through another
 * wallet: the agent takes no autonomous action and the item waits as needs_approval (spec 5.6).
 */
export class WalletError extends Error {
  constructor(
    readonly code: WalletErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

/** True when `signature` over `payload` was made by `expected`. */
export type SignatureVerifier = (payload: Eip712Payload, signature: Hex, expected: Address) => Promise<boolean>;

/** EOA verification by recovery. Needs no network. */
export const eoaVerifier: SignatureVerifier = async (payload, signature, expected) => {
  const recovered = await recoverTypedDataAddress({ ...payload, signature } as Parameters<typeof recoverTypedDataAddress>[0]);
  return recovered.toLowerCase() === expected.toLowerCase();
};

/** EOA or ERC-1271 verification through a chain client (needed if an Agent Wallet is a contract account, VERIFY 5.5 #5). */
export function chainVerifier(client: Pick<PublicClient, "verifyTypedData">): SignatureVerifier {
  return (payload, signature, expected) =>
    client.verifyTypedData({ address: expected, ...payload, signature } as Parameters<PublicClient["verifyTypedData"]>[0]);
}

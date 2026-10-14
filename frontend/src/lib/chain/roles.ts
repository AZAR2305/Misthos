import { parseAbi, type Address, type PublicClient } from "viem";

/**
 * RoleRegistry on Arc: a wallet is a supplier or a buyer, chosen once and fixed for good (no owner, no reset).
 * Everything that asks "what is this wallet?" reads it here, so the answer is the same on every reconnect and in every tab.
 */
export type OnChainRole = "supplier" | "buyer";
const NAMES: Record<number, OnChainRole | undefined> = { 1: "supplier", 2: "buyer" };
export const ROLE_VALUE: Record<OnChainRole, 1 | 2> = { supplier: 1, buyer: 2 };

export const ROLE_REGISTRY_ABI = parseAbi([
  "function roleOf(address) view returns (uint8)",
  "function choose(uint8 role)",
  "function chooseFor(address account, uint8 role, uint256 deadline, bytes signature)",
  "event RoleChosen(address indexed account, uint8 role, bool sponsored)",
]);

/** The wallet's fixed role, or null if it has not chosen one yet. Throws if the registry cannot be read: never guess a role. */
export async function readRole(client: Pick<PublicClient, "readContract">, registry: Address, account: Address): Promise<OnChainRole | null> {
  const v = Number(await client.readContract({ address: registry, abi: ROLE_REGISTRY_ABI, functionName: "roleOf", args: [account] }));
  return NAMES[v] ?? null;
}

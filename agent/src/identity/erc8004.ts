import { createPublicClient, http, keccak256, parseAbi, toHex, type Hex, type PublicClient } from "viem";
import type { Address, ContractCall, WalletAdapter } from "../wallets/types.js";

/**
 * ERC-8004 on Arc testnet: agent identity (an ERC-721 per agent) and reputation (feedback one account gives about another agent).
 * The interface below was confirmed against the deployed implementations on 14 Oct 2026: every selector is present in the bytecode
 * behind the proxies, and the Arc tutorial (docs.arc.io/arc/tutorials/register-your-first-ai-agent) uses the same argument types.
 *
 * Rules that shape the design:
 *  - An agent's owner cannot rate its own agent (anti self-dealing), so feedback is bilateral: each side rates the OTHER side's agent.
 *  - Circle's CLI cannot encode struct arguments; every call here is flat, so an Agent Wallet can make them.
 *  - Feedback is written only after a settlement the chain confirms, and a failed write never blocks or undoes a payment.
 */
export const ERC8004_ARC_TESTNET = {
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
  validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as Address,
};

export const REGISTER_FRAGMENT = "function register(string agentURI)";
export const GIVE_FEEDBACK_FRAGMENT =
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)";

export const IDENTITY_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
export const REPUTATION_ABI = parseAbi([
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function getClients(uint256 agentId) view returns (address[])",
]);

/** The tags every Misthos feedback carries, so a reader can ask for exactly this kind of rating. */
export const TAG_SETTLEMENT = "misthos.settlement";
export const TAG_EARLY_PAY = "early_pay";

/** A self-contained metadata document (no hosting needed): name, role and the wallet that acts for the agent. */
export function agentMetadataUri(a: { name: string; role: "supplier" | "buyer"; wallet: Address; chainId: number }): string {
  const doc = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: a.name,
    description: `A ${a.role} agent for business payment timing. It negotiates early payment of approved invoices and settles in USDC on Arc through the Misthos InvoiceBook contract.`,
    services: [{ name: "wallet", endpoint: `eip155:${a.chainId}:${a.wallet}` }],
    active: true,
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString("base64")}`;
}

export const registerCall = (identity: Address, uri: string): ContractCall => ({ to: identity, abi: REGISTER_FRAGMENT, fn: "register", args: [uri] });

/**
 * Feedback about a counterparty's agent after a real settlement. `value` is 100 for a settlement that completed as agreed
 * (a failed or disputed one would be written as a lower or negative value by a future caller). `feedbackHash` ties it to the invoice.
 */
export function feedbackCall(reputation: Address, f: { agentId: bigint; invoiceId: Hex; value?: number; endpoint?: string }): ContractCall {
  return {
    to: reputation,
    abi: GIVE_FEEDBACK_FRAGMENT,
    fn: "giveFeedback",
    args: [f.agentId, BigInt(f.value ?? 100), 0, TAG_SETTLEMENT, TAG_EARLY_PAY, f.endpoint ?? "", "", f.invoiceId],
    idempotencyKey: `feedback:${f.agentId}:${f.invoiceId}`,
  };
}

/** The agent id minted by a register transaction: the tokenId of the Transfer to the owner in that receipt. */
export async function agentIdFromRegistration(client: PublicClient, identity: Address, txHash: Hex, owner: Address): Promise<bigint | undefined> {
  const r = await client.getTransactionReceipt({ hash: txHash });
  const transfer = keccak256(toHex("Transfer(address,address,uint256)"));
  const log = r.logs.find((l) => l.address.toLowerCase() === identity.toLowerCase() && l.topics[0] === transfer && l.topics[2] && BigInt(l.topics[2]) === BigInt(owner));
  return log?.topics[3] ? BigInt(log.topics[3]) : undefined;
}

export interface ReputationSummary {
  /** How many pieces of feedback from the named raters. */
  count: number;
  /** Raw summed value over the raters you named, and its decimals. Not a canonical score. */
  value: bigint;
  decimals: number;
}

/**
 * What named raters said about an agent. The registry requires you to name the raters you trust (it will not give an anonymous
 * average), so pass the counterparty wallets you have actually dealt with.
 */
export async function readReputation(client: PublicClient, reputation: Address, agentId: bigint, raters: readonly Address[]): Promise<ReputationSummary | undefined> {
  if (raters.length === 0) return undefined;
  const [count, value, decimals] = await client.readContract({ address: reputation, abi: REPUTATION_ABI, functionName: "getSummary", args: [agentId, [...raters], TAG_SETTLEMENT, TAG_EARLY_PAY] });
  return { count: Number(count), value, decimals };
}

export const reputationClient = (rpcUrl: string): PublicClient => createPublicClient({ transport: http(rpcUrl) }) as PublicClient;

export interface FeedbackDeps {
  wallet: WalletAdapter;
  reputation: Address;
  /** The counterparty's agent id. Without it nothing is written (and nothing is guessed). */
  counterpartyAgentId?: bigint;
  log?: (msg: string) => void;
}

/**
 * Best effort and after the fact. Returns true if feedback was submitted. It never throws: a rating that cannot be written must not
 * affect a settlement that already happened.
 */
export async function writeSettlementFeedback(d: FeedbackDeps, invoiceId: Hex): Promise<boolean> {
  if (d.counterpartyAgentId === undefined) return false;
  try {
    const r = await d.wallet.execute(feedbackCall(d.reputation, { agentId: d.counterpartyAgentId, invoiceId }));
    d.log?.(`ERC-8004 feedback sent for agent ${d.counterpartyAgentId} on invoice ${invoiceId.slice(0, 10)}…${r.txHash ? ` (${r.txHash})` : ""}`);
    return true;
  } catch (e) {
    d.log?.(`ERC-8004 feedback not written: ${(e as Error).message}`);
    return false;
  }
}

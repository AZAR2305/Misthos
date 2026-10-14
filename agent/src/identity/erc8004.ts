import { createPublicClient, http, keccak256, parseAbi, toHex, type Hex, type PublicClient } from "viem";
import type { ReputationInput } from "../core/decide.js";
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
  "function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)",
  "function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)",
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

const MAX_CLIENTS = 25;
const RECENT = 5;

/**
 * The most recent feedback about an agent, read live from the registry, as the buyer's decision needs it.
 * VERIFY: ERC-8004 gives no global time order across raters without scanning events, so "most recent" here means the highest feedback index
 * (indices start at 1 and count up per rater) taken from each of up to 25 raters, newest index first. Revoked feedback is ignored.
 * A rating is "disputed" when it carries the tag "disputed" or a negative value.
 * No agent id, or no feedback at all, is "none" (a new address). A failed read THROWS: the caller turns that into REGISTRY_UNAVAILABLE.
 */
export async function readRecentReputation(client: PublicClient, reputation: Address, agentId: bigint | undefined): Promise<ReputationInput> {
  if (agentId === undefined) return { kind: "none" };
  const clients = (await client.readContract({ address: reputation, abi: REPUTATION_ABI, functionName: "getClients", args: [agentId] })) as readonly Address[];
  const rows: { index: bigint; order: number; disputed: boolean }[] = [];
  for (const [order, who] of clients.slice(0, MAX_CLIENTS).entries()) {
    const last = (await client.readContract({ address: reputation, abi: REPUTATION_ABI, functionName: "getLastIndex", args: [agentId, who] })) as bigint;
    for (let i = last; i >= 1n && i > last - BigInt(RECENT); i--) {
      const [value, , tag1, tag2, revoked] = (await client.readContract({ address: reputation, abi: REPUTATION_ABI, functionName: "readFeedback", args: [agentId, who, i] })) as readonly [bigint, number, string, string, boolean];
      if (!revoked) rows.push({ index: i, order, disputed: tag1.toLowerCase() === "disputed" || tag2.toLowerCase() === "disputed" || value < 0n });
    }
  }
  if (rows.length === 0) return { kind: "none" };
  rows.sort((a, b) => (a.index === b.index ? a.order - b.order : a.index > b.index ? -1 : 1));
  return { kind: "read", recent: rows.slice(0, RECENT).map((r) => ({ disputed: r.disputed })) };
}

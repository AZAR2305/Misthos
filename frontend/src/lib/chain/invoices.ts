import type { Hex, PublicClient } from "viem";
import { INVOICE_BOOK_ABI, ERC20_ABI } from "./abi";

type Address = `0x${string}`;

export type InvoiceStatus = "registered" | "approved" | "disputed" | "settled_early" | "settled_due";

export interface InvoiceRecord {
  id: Hex;
  supplier: Address;
  buyer: Address;
  token: Address;
  amount: bigint;
  /** Unix seconds. */
  dueDate: bigint;
  refHash: Hex;
  status: InvoiceStatus;
  registered: { tx: Hex; block: bigint };
  approved?: { tx: Hex; block: bigint; at: bigint };
  disputed?: { tx: Hex; block: bigint };
  settled?: {
    kind: "early" | "due";
    tx: Hex;
    block: bigint;
    net: bigint;
    discount: bigint;
    rateBps: number;
    fee: bigint;
    decisionHash?: Hex;
  };
}

/** A decoded InvoiceBook log, the shape viem's getLogs returns. */
export interface RawLog {
  eventName: string;
  args: Record<string, unknown>;
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
}

/** Fold the contract's events into one record per invoice. Pure, so it can be tested without a chain. */
export function buildInvoices(logs: readonly RawLog[]): InvoiceRecord[] {
  const sorted = [...logs].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  const byId = new Map<Hex, InvoiceRecord>();
  for (const l of sorted) {
    const a = l.args as Record<string, never>;
    const id = (a.id as Hex | undefined)?.toLowerCase() as Hex | undefined;
    if (l.eventName === "InvoiceRegistered" && id) {
      byId.set(id, {
        id,
        supplier: (a.supplier as Address).toLowerCase() as Address,
        buyer: (a.buyer as Address).toLowerCase() as Address,
        token: (a.token as Address).toLowerCase() as Address,
        amount: a.amount as bigint,
        dueDate: BigInt(a.dueDate as bigint),
        refHash: a.refHash as Hex,
        status: "registered",
        registered: { tx: l.transactionHash, block: l.blockNumber },
      });
      continue;
    }
    const rec = id ? byId.get(id) : undefined;
    if (!rec) continue;
    if (l.eventName === "InvoiceApproved") {
      rec.status = "approved";
      rec.approved = { tx: l.transactionHash, block: l.blockNumber, at: BigInt(a.approvedAt as bigint) };
    } else if (l.eventName === "InvoiceDisputed") {
      rec.status = "disputed";
      rec.disputed = { tx: l.transactionHash, block: l.blockNumber };
    } else if (l.eventName === "EarlySettled") {
      rec.status = "settled_early";
      rec.settled = {
        kind: "early",
        tx: l.transactionHash,
        block: l.blockNumber,
        net: a.net as bigint,
        discount: a.discount as bigint,
        rateBps: Number(a.rateBps),
        fee: a.fee as bigint,
        decisionHash: a.decisionHash as Hex,
      };
    } else if (l.eventName === "SettledOnDue") {
      rec.status = "settled_due";
      rec.settled = { kind: "due", tx: l.transactionHash, block: l.blockNumber, net: a.amount as bigint, discount: 0n, rateBps: 0, fee: 0n };
    }
  }
  return [...byId.values()];
}

const INVOICE_EVENTS = INVOICE_BOOK_ABI.filter((x) => x.type === "event" && x.name !== "LimitsSet");

/**
 * Read every invoice event from `fromBlock`. Public RPCs cap getLogs ranges, so a failed range is split in half until it
 * fits. Real chain reads only: if the RPC is unreachable this throws and the page shows the error.
 */
export async function fetchInvoiceLogs(client: PublicClient, book: Address, fromBlock: bigint): Promise<RawLog[]> {
  const latest = await client.getBlockNumber();
  const out: RawLog[] = [];
  const scan = async (from: bigint, to: bigint): Promise<void> => {
    try {
      const logs = await client.getLogs({ address: book, events: INVOICE_EVENTS as never, fromBlock: from, toBlock: to });
      for (const l of logs as unknown as Array<{ eventName: string; args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint; logIndex: number }>) {
        out.push({ eventName: l.eventName, args: l.args, transactionHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex });
      }
    } catch (e) {
      if (to <= from) throw e;
      const mid = from + (to - from) / 2n;
      await scan(from, mid);
      await scan(mid + 1n, to);
    }
  };
  await scan(fromBlock > latest ? latest : fromBlock, latest);
  return out;
}

/** Block timestamps for display (unix seconds), cached per block number. */
const blockTimeCache = new Map<bigint, number>();
export async function blockTimes(client: PublicClient, blocks: readonly bigint[]): Promise<Map<bigint, number>> {
  const unique = [...new Set(blocks)];
  await Promise.all(
    unique
      .filter((b) => !blockTimeCache.has(b))
      .map(async (b) => {
        const blk = await client.getBlock({ blockNumber: b });
        blockTimeCache.set(b, Number(blk.timestamp));
      }),
  );
  return blockTimeCache;
}

export interface BuyerChainState {
  balance: bigint;
  allowance: bigint;
  perInvoiceCap: bigint;
  dailyCap: bigint;
  spentToday: bigint;
}

/** The buyer's treasury and the on-chain caps, read from the chain. */
export async function readBuyerState(client: PublicClient, book: Address, usdc: Address, buyer: Address): Promise<BuyerChainState> {
  const day = BigInt(Math.floor(Date.now() / 1000 / 86_400));
  const [balance, allowance, limits, spentToday] = await Promise.all([
    client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [buyer] }),
    client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "allowance", args: [buyer, book] }),
    client.readContract({ address: book, abi: INVOICE_BOOK_ABI, functionName: "limits", args: [buyer] }),
    client.readContract({ address: book, abi: INVOICE_BOOK_ABI, functionName: "spentOnDay", args: [buyer, day] }),
  ]);
  return { balance, allowance, perInvoiceCap: limits[0], dailyCap: limits[1], spentToday };
}

export async function readUsdcBalance(client: PublicClient, usdc: Address, who: Address): Promise<bigint> {
  return client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [who] });
}

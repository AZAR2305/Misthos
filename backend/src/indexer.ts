import type { AbiEvent, Address, Hex, PublicClient } from "viem";
import type { Db } from "./db";
import { INVOICE_BOOK_ABI, buildInvoices, type InvoiceRecord, type RawLog } from "./shared";

const EVENTS = INVOICE_BOOK_ABI.filter((i): i is Extract<(typeof INVOICE_BOOK_ABI)[number], { type: "event" }> => i.type === "event");

/** viem returns uint8..uint48 as number and wider integers as bigint. Postgres stores them as JSON text, so restore the type. */
function reviveArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const ev = EVENTS.find((e) => e.name === name);
  if (!ev) return args;
  const out: Record<string, unknown> = { ...args };
  for (const input of ev.inputs) {
    const v = args[input.name!];
    const m = /^uint(\d+)$/.exec(input.type);
    if (m && typeof v === "string") out[input.name!] = Number(m[1]) <= 48 ? Number(v) : BigInt(v);
  }
  return out;
}

const store = (args: unknown) => JSON.stringify(args, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

export interface IndexerStatus {
  cursor: bigint | null;
  head: bigint | null;
  lastRunAt: Date | null;
  lastError: string | null;
}

export interface IndexerOptions {
  db: Db;
  client: Pick<PublicClient, "getBlockNumber" | "getLogs" | "getBlock">;
  book: Address;
  /** First block to read when nothing has been indexed yet (the deploy block). */
  startBlock: bigint;
  confirmations?: bigint;
  /** Blocks per getLogs call. */
  batch?: bigint;
}

const KEY = "invoice_book";

export async function getCursor(db: Db): Promise<bigint | null> {
  const r = await db.query<{ block: string }>("select block::text as block from indexer_state where key = $1", [KEY]);
  return r[0] ? BigInt(r[0].block) : null;
}

/**
 * Reads InvoiceBook logs after the stored cursor and writes them, their block times and the new cursor in one transaction.
 * Re-reading a range is harmless: events are unique on (tx_hash, log_index). Returns how many new events were stored.
 * Arc has deterministic finality, so there is no reorg handling; on a chain that can reorg, set CONFIRMATIONS.
 */
export async function indexOnce(o: IndexerOptions): Promise<{ from: bigint; to: bigint; events: number } | null> {
  const confirmations = o.confirmations ?? 0n;
  const head = await o.client.getBlockNumber();
  const safe = head - confirmations;
  const cursor = (await getCursor(o.db)) ?? o.startBlock - 1n;
  if (safe <= cursor) return null;
  const from = cursor + 1n;
  const to = safe < from + (o.batch ?? 2000n) - 1n ? safe : from + (o.batch ?? 2000n) - 1n;

  const logs = await o.client.getLogs({ address: o.book, events: EVENTS as unknown as readonly AbiEvent[], fromBlock: from, toBlock: to, strict: true });
  const blocks = [...new Set(logs.map((l) => l.blockNumber!))];
  const times = new Map<bigint, bigint>();
  for (const b of blocks) times.set(b, (await o.client.getBlock({ blockNumber: b })).timestamp);

  let stored = 0;
  await o.db.tx(async (t) => {
    for (const l of logs) {
      const inserted = await t.query<{ tx_hash: string }>(
        `insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, $2, $3, $4, $5::jsonb)
         on conflict (tx_hash, log_index) do nothing returning tx_hash`,
        [l.transactionHash, l.logIndex, l.blockNumber!.toString(), (l as { eventName: string }).eventName, store((l as { args: unknown }).args)],
      );
      stored += inserted.length;
    }
    for (const [b, ts] of times) {
      await t.query("insert into chain_blocks (block, time_sec) values ($1, $2) on conflict (block) do nothing", [b.toString(), ts.toString()]);
    }
    await t.query(
      `insert into indexer_state (key, block) values ($1, $2)
       on conflict (key) do update set block = excluded.block, updated_at = now()`,
      [KEY, to.toString()],
    );
  });
  return { from, to, events: stored };
}

/** Polls until stopped. Errors are recorded in the status (shown by /api/health) and retried; nothing is skipped. */
export function startIndexer(o: IndexerOptions & { pollMs: number }) {
  const status: IndexerStatus = { cursor: null, head: null, lastRunAt: null, lastError: null };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      while (!stopped && (await indexOnce(o)) !== null) {
        /* keep reading until caught up */
      }
      status.cursor = await getCursor(o.db);
      status.head = await o.client.getBlockNumber();
      status.lastError = null;
    } catch (e) {
      status.lastError = e instanceof Error ? e.message : String(e);
    }
    status.lastRunAt = new Date();
    if (!stopped) timer = setTimeout(tick, o.pollMs);
  };
  void tick();
  return {
    status,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** The read model: every stored event folded into one record per invoice by the same code the UI uses. */
export async function loadInvoices(db: Db): Promise<InvoiceRecord[]> {
  const rows = await db.query<{ tx_hash: string; log_index: number; block: string; name: string; payload_json: Record<string, unknown> }>(
    "select tx_hash, log_index, block::text as block, name, payload_json from chain_events order by chain_events.block, chain_events.log_index",
  );
  const logs: RawLog[] = rows.map((r) => ({
    eventName: r.name,
    args: reviveArgs(r.name, r.payload_json),
    transactionHash: r.tx_hash as Hex,
    blockNumber: BigInt(r.block),
    logIndex: r.log_index,
  }));
  return buildInvoices(logs);
}

/** Seconds since the epoch for an indexed block, or undefined if that block holds no stored event. */
export async function blockTimes(db: Db): Promise<(block: bigint) => number | undefined> {
  const rows = await db.query<{ block: string; time_sec: string }>("select block::text as block, time_sec::text as time_sec from chain_blocks");
  const m = new Map(rows.map((r) => [BigInt(r.block), Number(r.time_sec)]));
  return (b) => m.get(b);
}

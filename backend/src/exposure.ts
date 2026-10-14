import type { InvoiceEvent } from "./shared";
import type { InvoiceRecord } from "./shared";

/**
 * The invoices between two businesses, as the indexer read them from chain events, in the shape the agents' exposure
 * function takes. Everything here is public chain data; nothing private. Every settlement carries the transaction hash and
 * log index that prove it, so anyone can check it, and a settlement whose block time is not indexed is sent without a time
 * (the agent then counts it as unverified rather than guessing).
 */
export interface ExposureEventJson {
  invoiceId: string;
  state: "approved" | "settled_early" | "settled_on_due" | "disputed";
  face: string;
  outflow?: string;
  /** The yearly rate an early payment cleared at, in basis points. Lets a supplier start near what this buyer has accepted before. */
  rateBps?: number;
  dueSec: number;
  settledAtSec?: number;
  txHash?: string;
  logIndex?: number;
}

export function exposureEvents(
  records: readonly InvoiceRecord[],
  q: { side: "supplier" | "buyer"; owner: string; counterparty: string },
  blockTime: (block: bigint) => number | undefined,
): ExposureEventJson[] {
  const out: ExposureEventJson[] = [];
  for (const r of records) {
    const mine = q.side === "buyer" ? r.buyer === q.owner && r.supplier === q.counterparty : r.supplier === q.owner && r.buyer === q.counterparty;
    if (!mine || r.status === "registered") continue; // an invoice nobody approved creates no exposure
    const base = { invoiceId: r.id, face: r.amount.toString(), dueSec: Number(r.dueDate) };
    if (r.status === "approved") out.push({ ...base, state: "approved" });
    else if (r.status === "disputed") out.push({ ...base, state: "disputed" });
    else if (r.settled) {
      const early = r.status === "settled_early";
      out.push({
        ...base,
        state: early ? "settled_early" : "settled_on_due",
        ...(early ? { outflow: (r.settled.net + r.settled.fee).toString(), rateBps: r.settled.rateBps } : {}),
        settledAtSec: blockTime(r.settled.block),
        txHash: r.settled.tx,
        logIndex: r.settled.logIndex,
      });
    }
  }
  return out;
}

/** The wire shape into the agents' own type (bigint money, integer times). */
export function toInvoiceEvents(rows: readonly ExposureEventJson[]): InvoiceEvent[] {
  return rows.map((e) => ({
    invoiceId: e.invoiceId,
    state: e.state,
    face: BigInt(e.face),
    ...(e.outflow !== undefined ? { outflow: BigInt(e.outflow) } : {}),
    ...(e.rateBps !== undefined ? { rateBps: e.rateBps } : {}),
    dueSec: BigInt(e.dueSec),
    ...(e.settledAtSec !== undefined ? { settledAtSec: BigInt(e.settledAtSec) } : {}),
    ...(e.txHash !== undefined ? { txHash: e.txHash } : {}),
    ...(e.logIndex !== undefined ? { logIndex: e.logIndex } : {}),
  }));
}

/**
 * What a buyer owes on invoices that are approved and not yet paid, whoever the supplier is. These are on-chain facts, so they are
 * the one obligation that is verified rather than declared: the contract itself will take this money on the due date.
 */
export interface PayableJson {
  invoiceId: string;
  face: string;
  dueSec: number;
}

export function payablesOf(records: readonly InvoiceRecord[], buyer: string): PayableJson[] {
  return records
    .filter((r) => r.buyer === buyer && r.status === "approved")
    .map((r) => ({ invoiceId: r.id, face: r.amount.toString(), dueSec: Number(r.dueDate) }))
    .sort((a, b) => (a.invoiceId < b.invoiceId ? -1 : 1));
}

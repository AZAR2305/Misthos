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
        ...(early ? { outflow: (r.settled.net + r.settled.fee).toString() } : {}),
        settledAtSec: blockTime(r.settled.block),
        txHash: r.settled.tx,
        logIndex: r.settled.logIndex,
      });
    }
  }
  return out;
}

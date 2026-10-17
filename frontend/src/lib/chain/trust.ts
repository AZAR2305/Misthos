import type { InvoiceRecord } from "./invoices";
import { findDuplicate } from "./duplicates";

/**
 * What the chain itself says about the two parties of an invoice, counted from the invoices the site has read. Nothing here is declared by anyone:
 * every number is a count of settlement events in the contract log. Settlements with other parties are not counted for this pair.
 */
export interface TrustFacts {
  /** Invoices between exactly this supplier and buyer, apart from this one, that the contract shows as paid. */
  pairSettled: number;
  /** Of those, how many were paid early. */
  pairSettledEarly: number;
  /** Open disputes between the pair. */
  pairDisputed: number;
  /** Total face value paid between the pair, in minor units. */
  pairVolume: bigint;
  firstTimePair: boolean;
  duplicateOf?: string;
}

export function trustFacts(all: readonly InvoiceRecord[], inv: InvoiceRecord): TrustFacts {
  const pair = all.filter((i) => i.id !== inv.id && i.supplier === inv.supplier && i.buyer === inv.buyer);
  const paid = pair.filter((i) => i.settled);
  return {
    pairSettled: paid.length,
    pairSettledEarly: paid.filter((i) => i.settled?.kind === "early").length,
    pairDisputed: pair.filter((i) => i.status === "disputed").length,
    pairVolume: paid.reduce((n, i) => n + i.amount, 0n),
    firstTimePair: paid.length === 0,
    duplicateOf: findDuplicate(all, inv),
  };
}

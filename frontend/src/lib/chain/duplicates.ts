import type { InvoiceRecord } from "./invoices";

/**
 * A possible duplicate: another invoice with the same supplier, buyer, amount and reference hash. A real supplier does not usually send the same invoice
 * twice under a new nonce, so it is flagged for the buyer (never blocked on chain). Returns the id of the EARLIEST other invoice it matches, or undefined.
 * A disputed invoice is not counted as the original: the dispute is the buyer saying it was wrong.
 */
export function findDuplicate(all: readonly InvoiceRecord[], inv: Pick<InvoiceRecord, "id" | "supplier" | "buyer" | "amount" | "refHash">): string | undefined {
  const same = all.filter((o) => o.id !== inv.id && o.supplier === inv.supplier && o.buyer === inv.buyer && o.amount === inv.amount && o.refHash === inv.refHash && o.status !== "disputed");
  if (same.length === 0) return undefined;
  return same.sort((a, b) => (a.registered.block === b.registered.block ? 0 : a.registered.block < b.registered.block ? -1 : 1))[0]!.id;
}

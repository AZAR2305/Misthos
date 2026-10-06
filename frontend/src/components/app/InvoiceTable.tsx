"use client";

import Link from "next/link";
import { AddressChip, Money, StatusChip } from "@/components/ui/kit";
import type { InvoiceRecord } from "@/lib/chain/invoices";
import { dateOnly, dueText, invoiceName, useNow } from "@/lib/format";
import { useInvoiceMeta } from "@/lib/storage";

/** What the person should do next, in plain words. */
export function nextStep(inv: InvoiceRecord, me: string | undefined, now: number): string {
  const isBuyer = me && inv.buyer === me.toLowerCase();
  const isSupplier = me && inv.supplier === me.toLowerCase();
  switch (inv.status) {
    case "registered":
      return isBuyer ? "Approve or dispute" : "Waiting for the buyer to approve";
    case "approved":
      if (Number(inv.dueDate) <= now) return isBuyer ? "Pay now: it is due" : "Due: waiting for payment";
      return isBuyer ? "Pay early with an offer" : isSupplier ? "Offer early payment" : "Open for an early-pay offer";
    case "disputed":
      return "On hold: disputed";
    case "settled_early":
      return "Done: paid early";
    case "settled_due":
      return "Done: paid on the due date";
  }
}

/** Dense, sortable-by-due list. `side` decides which counterparty to show. */
export function InvoiceTable({ invoices, me, side }: { invoices: InvoiceRecord[]; me?: string; side: "supplier" | "buyer" | "both" }) {
  const [meta] = useInvoiceMeta();
  const now = useNow();
  const rows = [...invoices].sort((a, b) => Number(a.dueDate - b.dueDate));
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Invoice</th>
            {side !== "supplier" && <th>Supplier</th>}
            {side !== "buyer" && <th>Buyer</th>}
            <th className="num">Amount</th>
            <th>Due</th>
            <th>Status</th>
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id}>
              <td>
                <Link className="row-link" href={`/invoices/${i.id}`}>{invoiceName(i.id, meta)}</Link>
              </td>
              {side !== "supplier" && <td><AddressChip address={i.supplier} you={me?.toLowerCase() === i.supplier} /></td>}
              {side !== "buyer" && <td><AddressChip address={i.buyer} you={me?.toLowerCase() === i.buyer} /></td>}
              <td className="num"><Money minor={i.amount} /></td>
              <td>
                {dateOnly(i.dueDate)}
                <br />
                <span className="muted tiny">{dueText(i.dueDate, now)}</span>
              </td>
              <td><StatusChip status={i.status} /></td>
              <td className="muted">{nextStep(i, me, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

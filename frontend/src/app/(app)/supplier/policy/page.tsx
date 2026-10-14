"use client";

import { ExposurePolicyCard } from "@/components/app/ExposurePolicyCard";
import { LinkAgentCard } from "@/components/app/LinkAgentCard";
import { PageHeader, Term } from "@/components/ui/kit";

export default function SupplierPolicy() {
  return (
    <>
      <PageHeader
        title="Credit limits"
        lead="How much you will let one buyer owe you. Nobody is given credit until you decide."
        help={
          <>
            <p><b>What this limits.</b> The total a single buyer may owe you across approved, unpaid invoices. A new invoice that would take them past it is flagged on the invoice page.</p>
            <p><b>How a limit grows.</b> A business you have not dealt with gets the starting limit. Each invoice it settles through Arc raises its limit by the percentage you choose, up to your maximum. Only <Term tip="Invoices settled on Arc with a transaction behind them. Each counts once.">verified settlements</Term> count.</p>
            <p><b>Overdue is not fraud.</b> An overdue invoice stays owed and stops adding to the limit. It is never treated as a default, and the limit recovers once it is paid.</p>
          </>
        }
      />
      <div style={{ display: "grid", gap: 20 }}>
        <ExposurePolicyCard side="supplier" />
        <LinkAgentCard side="supplier" />
      </div>
    </>
  );
}

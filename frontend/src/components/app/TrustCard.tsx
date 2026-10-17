"use client";

import { AddressChip, Card, Money, Tag } from "@/components/ui/kit";
import { useOnChainRole } from "@/lib/hooks";
import type { InvoiceRecord } from "@/lib/chain/invoices";
import { trustFacts } from "@/lib/chain/trust";

type Row = { tone: "ok" | "warn" | "off"; label: string; text: React.ReactNode; source: "on chain" | "unavailable" };

/**
 * Who is on the other side, and what the chain says about them. Every row names its source. Declared things (a name someone typed, a profile) are not
 * shown here at all: this card is only what a contract log or a registry read can prove, and says "unavailable" when a source cannot be read.
 */
export function TrustCard({ inv, all, me }: { inv: InvoiceRecord; all: readonly InvoiceRecord[]; me?: string }) {
  const sup = useOnChainRole(inv.supplier);
  const buy = useOnChainRole(inv.buyer);
  const f = trustFacts(all, inv);

  const roleRow = (who: "supplier" | "buyer", st: ReturnType<typeof useOnChainRole>): Row => {
    const label = who === "supplier" ? "Supplier role" : "Buyer role";
    if (st.status === "off") return { tone: "off", label, text: "No role registry is configured on this site.", source: "unavailable" };
    if (st.status === "loading") return { tone: "off", label, text: "Reading the registry…", source: "unavailable" };
    if (st.status === "error" && !st.role) return { tone: "off", label, text: "The registry could not be read right now.", source: "unavailable" };
    if (st.role === who) return { tone: "ok", label, text: `Registered on Arc as a ${who}. This wallet can never be the other side.`, source: "on chain" };
    if (st.role) return { tone: "warn", label, text: `This wallet is registered as a ${st.role}, not a ${who}. Do not trust this invoice.`, source: "on chain" };
    return { tone: "warn", label, text: `Not registered on Arc as a ${who} yet.`, source: "on chain" };
  };

  const rows: Row[] = [
    roleRow("supplier", sup),
    roleRow("buyer", buy),
    f.firstTimePair
      ? { tone: "warn", label: "History together", text: "No earlier invoice between these two wallets has been paid. Treat the first one with care.", source: "on chain" }
      : { tone: "ok", label: "History together", text: <>{f.pairSettled} invoice{f.pairSettled === 1 ? "" : "s"} paid between them ({f.pairSettledEarly} early), <Money minor={f.pairVolume} /> in total.</>, source: "on chain" },
    f.pairDisputed > 0
      ? { tone: "warn", label: "Disputes", text: `${f.pairDisputed} invoice${f.pairDisputed === 1 ? " is" : "s are"} disputed between them right now.`, source: "on chain" }
      : { tone: "ok", label: "Disputes", text: "None open between them.", source: "on chain" },
    f.duplicateOf
      ? { tone: "warn", label: "Possible duplicate", text: <>Same supplier, buyer, amount and reference as invoice {f.duplicateOf.slice(0, 10)}…</>, source: "on chain" }
      : { tone: "ok", label: "Possible duplicate", text: "No earlier invoice with the same supplier, buyer, amount and reference.", source: "on chain" },
  ];

  return (
    <Card title="Trust" aside={<Tag>verified, not declared</Tag>}>
      <dl className="kv">
        <div><dt>Supplier</dt><dd><AddressChip address={inv.supplier} you={me === inv.supplier} /></dd></div>
        <div><dt>Buyer</dt><dd><AddressChip address={inv.buyer} you={me === inv.buyer} /></dd></div>
        {rows.map((r) => (
          <div key={r.label} data-trust={r.tone}>
            <dt>{r.label}</dt>
            <dd>
              {r.text} <span className="muted tiny">({r.source})</span>
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

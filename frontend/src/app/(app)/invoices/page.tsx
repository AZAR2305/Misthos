"use client";

import Link from "next/link";
import { ConnectPrompt } from "@/components/app/Gate";
import { useState } from "react";
import { InvoiceTable } from "@/components/app/InvoiceTable";
import { useChainData } from "@/components/app/ChainData";
import { Empty, PageHeader, Skeleton } from "@/components/ui/kit";
import { useWallet } from "@/components/wallet/WalletProvider";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "open", label: "Open" },
  { id: "paid", label: "Paid" },
] as const;

export default function AllInvoices() {
  const chain = useChainData();
  const w = useWallet();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const me = w.address?.toLowerCase();
  const list = chain.invoices.filter((i) =>
    filter === "mine" ? i.supplier === me || i.buyer === me : filter === "open" ? i.status === "registered" || i.status === "approved" : filter === "paid" ? i.status === "settled_early" || i.status === "settled_due" : true,
  );

  return (
    <>
      <PageHeader
        title="All invoices"
        lead="Every invoice recorded on this network. This is public: anyone can read it and check it on the explorer."
        actions={<Link className="btn btn-primary" href="/supplier/invoices/new">New invoice</Link>}
        help={<p>Invoices are public records, but only amounts and addresses are on chain. References and notes stay on the device that created them. Open any invoice to follow it from signature to payment.</p>}
      />
      <ConnectPrompt />
      <div className="quick" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="pill-btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      {chain.status === "loading" ? (
        <Skeleton rows={5} />
      ) : list.length === 0 ? (
        <Empty
          title={chain.status === "unconfigured" ? "The contract is not deployed on this network yet" : "No invoices match"}
          body={chain.status === "unconfigured" ? "Once it is deployed, every invoice appears here." : filter === "all" ? "No invoice has been created yet. Create the first one." : "Try another filter."}
          action={<Link className="btn btn-primary" href="/supplier/invoices/new">New invoice</Link>}
        />
      ) : (
        <InvoiceTable invoices={list} me={me} side="both" />
      )}
    </>
  );
}

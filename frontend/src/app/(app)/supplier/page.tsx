"use client";

import Link from "next/link";
import { InvoiceTable } from "@/components/app/InvoiceTable";
import { useChainData } from "@/components/app/ChainData";
import { RequireWallet } from "@/components/app/RequireWallet";
import { Card, Empty, Money, PageHeader, Skeleton, Stat, Term } from "@/components/ui/kit";
import { AgentPanel } from "@/components/app/AgentPanel";
import { CONFIG } from "@/lib/config";
import { costOfWaiting } from "@/lib/core";
import { dateOnly, dueText, useNow } from "@/lib/format";

export default function SupplierDashboard() {
  const chain = useChainData();
  const now = useNow();

  return (
    <>
      <PageHeader
        title="My invoices"
        lead="What you are owed, what is waiting on a buyer, and where early payment could help."
        actions={<Link className="btn btn-primary" href="/supplier/invoices/new">New invoice</Link>}
        help={
          <>
            <p><b>What you see.</b> Every invoice where your wallet is the supplier, read from the chain.</p>
            <p><b>Status.</b> <Term tip="You signed it and it is recorded on Arc.">Registered</Term> means waiting for the buyer. <Term tip="The buyer accepted the work. Only approved invoices can be paid early.">Approved</Term> means you can offer early payment. <Term tip="The buyer's cash reached you before the due date.">Paid early</Term> means done.</p>
            <p><b>Early payment.</b> Open an approved invoice and sign an offer at a rate you choose, or let your agent climb a ladder from 0%. You never receive less than the price you signed.</p>
          </>
        }
      />
      <RequireWallet why="Your invoices are the ones your wallet signed. Connect to see them and to create new ones.">
        {(me) => {
          const mine = chain.invoices.filter((i) => i.supplier === me);
          const open = mine.filter((i) => i.status === "registered" || i.status === "approved");
          const waiting = open.reduce((s, i) => s + i.amount, 0n);
          const nextDue = open.map((i) => i.dueDate).sort((a, b) => Number(a - b))[0];
          const approved = mine.filter((i) => i.status === "approved" && Number(i.dueDate) > now);
          const paidEarly = mine.filter((i) => i.status === "settled_early");

          return (
            <>
              <div className="stats">
                <Stat label="Open invoices" value={open.length} hint="Registered or approved" />
                <Stat label="Waiting on" value={<Money minor={waiting} accent />} hint="Face value, before any discount" />
                <Stat label="Next due" value={nextDue ? dateOnly(nextDue) : "None"} hint={nextDue ? dueText(nextDue, now) : "Nothing waiting"} />
                <Stat label="Paid early so far" value={paidEarly.length} hint={paidEarly.length ? "See the ledger for the numbers" : "None yet"} />
              </div>

              <div className="split">
                <div className="stack">
                  {chain.status === "loading" ? (
                    <Skeleton rows={4} />
                  ) : chain.status === "unconfigured" ? (
                    <Empty title="Nothing to show yet" body="The contract is not deployed on this network, so no invoice can exist." />
                  ) : mine.length === 0 ? (
                    <Empty
                      title="No invoices yet. Create your first invoice."
                      body="You sign it once with your wallet. The buyer then approves it, and you can offer to be paid early."
                      action={<Link className="btn btn-primary" href="/supplier/invoices/new">New invoice</Link>}
                    />
                  ) : (
                    <>
                      <InvoiceTable invoices={mine} me={me} side="supplier" />
                      <p className="muted tiny">Every status and amount is read from Arc. The proof link on each row opens the transaction on the explorer.</p>
                    </>
                  )}
                </div>

                <div className="stack">
                  <Card title="Next best step">
                    {approved.length === 0 ? (
                      <p className="muted">
                        {open.length === 0
                          ? "Create an invoice to get started."
                          : "Nothing is approved yet. Early payment can start as soon as a buyer approves an invoice."}
                      </p>
                    ) : (
                      approved.slice(0, 3).map((i) => {
                        const secs = i.dueDate - BigInt(now);
                        return (
                          <div key={i.id} className="preview">
                            <p><Link className="row-link" href={`/invoices/${i.id}`}>Offer early payment on this invoice</Link></p>
                            <p className="muted tiny">
                              At 0% you would receive <Money minor={i.amount} accent /> today instead of on {dateOnly(i.dueDate)}.
                              Waiting {Math.floor(Number(secs) / 86400)} days on a 22% card would cost about <Money minor={costOfWaiting(i.amount, 2200, secs)} />.
                            </p>
                          </div>
                        );
                      })
                    )}
                  </Card>
                  <AgentPanel role="supplier" url={CONFIG.supplierAgentUrl} />
                </div>
              </div>
            </>
          );
        }}
      </RequireWallet>
    </>
  );
}

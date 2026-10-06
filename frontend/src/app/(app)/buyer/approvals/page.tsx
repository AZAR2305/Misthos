"use client";

import Link from "next/link";
import { useState } from "react";
import { useChainData } from "@/components/app/ChainData";
import { RequireWallet } from "@/components/app/RequireWallet";
import { AddressChip, Card, Empty, Modal, Money, Notice, PageHeader, StatusChip, Tag } from "@/components/ui/kit";
import { INVOICE_BOOK_ABI } from "@/lib/chain/abi";
import { appChain } from "@/lib/chain/client";
import type { InvoiceRecord } from "@/lib/chain/invoices";
import { CONFIG } from "@/lib/config";
import { dateOnly, dueText, invoiceName, useNow } from "@/lib/format";
import { useAgentDecisions } from "@/lib/hooks";
import { useInvoiceMeta } from "@/lib/storage";
import { useTx } from "@/lib/tx";

export default function Approvals() {
  return (
    <>
      <PageHeader
        title="Approvals"
        lead="The two places a person has to say yes: invoices you owe, and early payments your agent held back for you."
        help={
          <>
            <p><b>Approve an invoice</b> when the work or goods are accepted. It tells the contract this invoice is real and payable, which lets the supplier offer early payment.</p>
            <p><b>Dispute</b> if something is wrong. A disputed invoice can never be paid by the contract.</p>
            <p><b>Held back by your agent.</b> Payments above the amount you set for sign-off, or ones the agent could not complete (for example an expired wallet session), wait here with the reason.</p>
          </>
        }
      />
      <RequireWallet why="Only the buyer named on an invoice can approve it. Connect the buyer's wallet.">{(me) => <Body me={me} />}</RequireWallet>
    </>
  );
}

function Body({ me }: { me: `0x${string}` }) {
  const chain = useChainData();
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const waiting = chain.invoices.filter((i) => i.buyer === me && i.status === "registered");
  const held = useHeld();

  return (
    <>
      <div className="quick" role="tablist" aria-label="Approval type">
        <button role="tab" aria-selected={tab === "invoices"} type="button" className="pill-btn" aria-pressed={tab === "invoices"} onClick={() => setTab("invoices")}>Invoices to approve ({waiting.length})</button>
        <button role="tab" aria-selected={tab === "payments"} type="button" className="pill-btn" aria-pressed={tab === "payments"} onClick={() => setTab("payments")}>Held by your agent ({held.items.length})</button>
      </div>

      {tab === "invoices" ? (
        waiting.length === 0 ? (
          <Empty title="Nothing waiting for you" body="When a supplier sends you an invoice, it appears here to approve or dispute." action={<Link className="btn btn-ghost" href="/buyer">Back to the buyer dashboard</Link>} />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>{waiting.map((i) => <ApprovalCard key={i.id} inv={i} />)}</div>
        )
      ) : held.status === "offline" ? (
        <Notice kind="info" title="Your buyer agent is not running">There is nothing held back to show. Start it (see <Link href="/docs/run-the-agents">Run the agents</Link>) to see payments that need you.</Notice>
      ) : held.items.length === 0 ? (
        <Empty title="Nothing is held back" body="Payments the agent could not or should not make on its own will wait here, with the reason." />
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {held.items.map((h) => (
            <Card key={h.invoiceId} title={<Link className="row-link" href={`/invoices/${h.invoiceId}`}>Invoice {h.invoiceId.slice(0, 10)}…</Link>} aside={<Tag tone="agent">agent</Tag>}>
              <p><b>{h.reasonCode.replace(/_/g, " ").toLowerCase()}.</b> <span className="muted">{h.reason}</span></p>
              <Link className="btn btn-ghost btn-sm" href={`/invoices/${h.invoiceId}`}>Open invoice</Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function useHeld() {
  const log = useAgentDecisions(CONFIG.buyerAgentUrl);
  // Items whose latest decision is needs_approval and that are not settled yet.
  const chain = useChainData();
  const latest = new Map<string, { reasonCode: string; reason: string }>();
  for (const d of log.entries) {
    const id = d.snapshot.invoiceId?.toLowerCase();
    if (!id || id === "plan") continue;
    if (d.outcome === "needs_approval") {
      const m = /^([A-Z_]+): (.*)$/.exec(d.reason);
      latest.set(id, { reasonCode: m?.[1] ?? "NEEDS_HUMAN_APPROVAL", reason: m?.[2] ?? d.reason });
    } else latest.delete(id);
  }
  const items = [...latest].filter(([id]) => !chain.invoices.find((i) => i.id === id)?.settled).map(([invoiceId, v]) => ({ invoiceId, ...v }));
  return { status: log.status === "offline" ? ("offline" as const) : ("ready" as const), items };
}

function ApprovalCard({ inv }: { inv: InvoiceRecord }) {
  const tx = useTx();
  const now = useNow();
  const [meta] = useInvoiceMeta();
  const [confirm, setConfirm] = useState(false);
  const run = (kind: "approveInvoice" | "dispute") =>
    tx.run(kind === "approveInvoice" ? { pending: "Approving invoice", done: "Invoice approved" } : { pending: "Disputing invoice", done: "Invoice disputed" }, (wc, account) =>
      wc.writeContract({ address: CONFIG.book!, abi: INVOICE_BOOK_ABI, functionName: kind, args: [inv.id], account, chain: appChain }),
    );
  return (
    <Card title={<Link className="row-link" href={`/invoices/${inv.id}`}>{invoiceName(inv.id, meta)}</Link>} aside={<StatusChip status={inv.status} />}>
      <dl className="kv">
        <div><dt>Supplier</dt><dd><AddressChip address={inv.supplier} /></dd></div>
        <div><dt>Amount</dt><dd><Money minor={inv.amount} accent /></dd></div>
        <div><dt>Due</dt><dd>{dateOnly(inv.dueDate)} <span className="muted tiny">({dueText(inv.dueDate, now)})</span></dd></div>
      </dl>
      <p className="muted tiny">Approving confirms the work is accepted. The supplier can then offer to be paid early. You decide whether to accept.</p>
      <div className="actions-row">
        <button type="button" className="btn btn-primary" disabled={!!tx.busy} onClick={() => void run("approveInvoice")}>{tx.busy ? `${tx.busy}…` : "Approve invoice"}</button>
        <button type="button" className="btn btn-danger" disabled={!!tx.busy} onClick={() => setConfirm(true)}>Dispute</button>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Dispute this invoice?" footer={<><button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="btn btn-danger" onClick={() => { setConfirm(false); void run("dispute"); }}>Dispute invoice</button></>}>
        <p>A disputed invoice can never be paid by the contract, early or on time. This cannot be undone on chain.</p>
      </Modal>
    </Card>
  );
}

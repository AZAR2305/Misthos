"use client";

import { useMemo, useState } from "react";
import { useChainData } from "@/components/app/ChainData";
import { RequireWallet } from "@/components/app/RequireWallet";
import { Card, Empty, Money, Notice, PageHeader, Tag, TxLink } from "@/components/ui/kit";
import { balanced, journalFrom, toBeancount, toCsv, type Side } from "@/lib/accounting";
import { CONFIG } from "@/lib/config";
import { verifyChain, type StoredDecision } from "@/lib/core";
import { dateTime, shortId } from "@/lib/format";
import { useAgentDecisions } from "@/lib/hooks";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Ledger() {
  const [tab, setTab] = useState<"journal" | "log">("journal");
  return (
    <>
      <PageHeader
        title="Ledger"
        lead="The accounting for every early payment, and the agents' reasons for every decision."
        help={
          <>
            <p><b>Journal.</b> One balanced entry per settled invoice, built from the chain. The buyer books the discount as income, the supplier as an expense, and the small success fee separately. Debits always equal credits.</p>
            <p><b>Decision log.</b> Each agent writes down what it saw, what it did and why, linking every entry to the one before. You can recompute the chain here: if anyone edited an old entry, the check names the first bad one.</p>
            <p><b>Export.</b> Download a CSV for a spreadsheet or a beancount file for plain-text accounting. Run <span className="inline-code">bean-check</span> on the beancount file before you rely on it.</p>
          </>
        }
      />
      <div className="quick" role="tablist" aria-label="Ledger sections">
        <button role="tab" aria-selected={tab === "journal"} type="button" className="pill-btn" aria-pressed={tab === "journal"} onClick={() => setTab("journal")}>Journal and export</button>
        <button role="tab" aria-selected={tab === "log"} type="button" className="pill-btn" aria-pressed={tab === "log"} onClick={() => setTab("log")}>Decision log</button>
      </div>
      {tab === "journal" ? <RequireWallet why="The journal is built from the invoices your wallet took part in.">{(me) => <Journal me={me} />}</RequireWallet> : <DecisionLog />}
    </>
  );
}

function Journal({ me }: { me: `0x${string}` }) {
  const chain = useChainData();
  const [side, setSide] = useState<Side>("buyer");
  const lines = useMemo(() => journalFrom(side, chain.invoices, me), [chain.invoices, side, me]);
  const time = (b: bigint) => chain.time(b);

  return (
    <>
      <div className="quick" role="group" aria-label="Which side">
        <button type="button" className="pill-btn" aria-pressed={side === "buyer"} onClick={() => setSide("buyer")}>As buyer</button>
        <button type="button" className="pill-btn" aria-pressed={side === "supplier"} onClick={() => setSide("supplier")}>As supplier</button>
      </div>
      {lines.length === 0 ? (
        <Empty title={`No settled invoices as ${side} yet`} body="When an invoice you took part in is paid, its journal entry appears here." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Invoice</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th><th>Memo</th><th>Transaction</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={`${l.tx}-${i}`}>
                    <td>{time(l.block) ? dateTime(time(l.block)!) : "…"}</td>
                    <td className="mono tiny">{shortId(l.invoiceId)}</td>
                    <td>{l.account}</td>
                    <td className="num">{l.debit > 0n ? <Money minor={l.debit} dp={6} /> : ""}</td>
                    <td className="num">{l.credit > 0n ? <Money minor={l.credit} dp={6} /> : ""}</td>
                    <td className="muted">{l.memo}</td>
                    <td><TxLink hash={l.tx} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notice kind={balanced(lines) ? "ok" : "error"} title={balanced(lines) ? "Debits equal credits for every invoice" : "These entries do not balance"} />
          <div className="actions-row">
            <button type="button" className="btn btn-primary" onClick={() => download(`misthos-${side}-journal.csv`, toCsv(lines, time), "text/csv")}>Download CSV</button>
            <button type="button" className="btn btn-ghost" onClick={() => download(`misthos-${side}.beancount`, toBeancount(lines, time), "text/plain")}>Download beancount</button>
          </div>
        </>
      )}
    </>
  );
}

function DecisionLog() {
  const supplier = useAgentDecisions(CONFIG.supplierAgentUrl);
  const buyer = useAgentDecisions(CONFIG.buyerAgentUrl);
  const [verdict, setVerdict] = useState<string>();
  const all = [...supplier.entries.map((e) => ({ ...e, who: "Supplier agent" })), ...buyer.entries.map((e) => ({ ...e, who: "Buyer agent" }))];

  const verify = () => {
    const parts = [
      ["Supplier agent", supplier.entries],
      ["Buyer agent", buyer.entries],
    ] as const;
    const msgs = parts.filter(([, e]) => e.length > 0).map(([n, e]) => {
      const r = verifyChain(e as unknown as StoredDecision[]);
      return r.ok ? `${n}: ${e.length} entries verify` : `${n}: entry ${r.badIndex + 1} does not match its hash`;
    });
    setVerdict(msgs.length ? msgs.join(". ") + "." : "There are no entries to check.");
  };

  if (supplier.status === "offline" && buyer.status === "offline") {
    return (
      <Empty
        title="No agent is running"
        body="Each agent keeps its own log while it runs. Start an agent to see what it decides and why."
        action={<span className="code">pnpm --filter @misthos/agent buyer</span>}
      />
    );
  }
  return (
    <>
      {all.length === 0 ? (
        <Empty title="No decisions yet" body="The agents have not decided anything yet. Their reasons will appear here as they work." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Who</th><th>Invoice</th><th>Outcome</th><th>Reason</th><th>Entry hash</th></tr></thead>
            <tbody>
              {all.map((e) => (
                <tr key={e.hash}>
                  <td>{e.who} <Tag tone="agent">agent</Tag></td>
                  <td className="mono tiny">{e.snapshot.invoiceId ? shortId(e.snapshot.invoiceId) : "plan"}</td>
                  <td>{e.outcome.replace("_", " ")}</td>
                  <td className="muted">{e.reason}</td>
                  <td className="mono tiny">{shortId(e.hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="actions-row">
        <button type="button" className="btn btn-primary" onClick={verify}>Verify the chain</button>
        {verdict && <span role="status">{verdict}</span>}
      </div>
      <Card title="Why a hash chain?">
        <p className="muted">Each entry includes the hash of the one before it. Changing any past decision would change every hash after it, so tampering is visible. The decision hash is also written on chain with each settlement, tying the payment to the reasoning behind it.</p>
      </Card>
    </>
  );
}

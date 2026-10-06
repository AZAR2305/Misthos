"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AgentNote, AddressChip, Card, Empty, Modal, Money, Notice, PageHeader, Skeleton, Stepper, StatusChip, Tag, TxLink, Term } from "@/components/ui/kit";
import { useChainData } from "@/components/app/ChainData";
import { DiscountCurve } from "@/components/app/DiscountCurve";
import { OfferButton, PayEarlyButton } from "@/components/app/OfferFlows";
import { InviteSupplier } from "@/components/app/ClaimLinks";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ERC20_ABI, INVOICE_BOOK_ABI } from "@/lib/chain/abi";
import { appChain, publicClient } from "@/lib/chain/client";
import { CONFIG } from "@/lib/config";
import { discountOf, effectiveAprBps } from "@/lib/core";
import { dateOnly, dateTime, dueText, invoiceName, shortId, useNow } from "@/lib/format";
import { useAgentDecisions } from "@/lib/hooks";
import { useInvoiceMeta, useIssuedOffers } from "@/lib/storage";
import { useTx } from "@/lib/tx";

export default function InvoicePage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = raw.toLowerCase();
  const chain = useChainData();
  const w = useWallet();
  const now = useNow();
  const [meta] = useInvoiceMeta();
  const [issued] = useIssuedOffers();
  const tx = useTx();
  const supplierLog = useAgentDecisions(CONFIG.supplierAgentUrl);
  const buyerLog = useAgentDecisions(CONFIG.buyerAgentUrl);
  const [confirmDispute, setConfirmDispute] = useState(false);
  const [previewPct, setPreviewPct] = useState(0);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentResult, setAgentResult] = useState<string>();

  const inv = chain.invoices.find((i) => i.id === id);
  const me = w.address?.toLowerCase();

  if (chain.status === "loading") return <Skeleton rows={6} />;
  if (!inv) {
    return (
      <Empty
        title="Invoice not found on this network"
        body={`There is no invoice ${shortId(id)} on ${CONFIG.networkName}${chain.status === "unconfigured" ? " (the contract is not deployed here yet)" : ""}. It may still be confirming, or you may be on the wrong network.`}
        action={<Link className="btn btn-ghost" href="/invoices">See all invoices</Link>}
      />
    );
  }

  const isBuyer = me === inv.buyer;
  const isSupplier = me === inv.supplier;
  const settled = inv.settled;
  const terms = Number(inv.dueDate) > now ? previewPct : 0;
  const secs = BigInt(Math.max(0, Number(inv.dueDate) - now));
  const previewBps = Math.round(previewPct * 100);
  const pDiscount = discountOf(inv.amount, previewBps, secs);
  const stepIndex = settled ? 5 : inv.status === "approved" ? 3 : 2;
  const registeredAt = chain.time(inv.registered.block);
  const startSec = registeredAt ?? now - 30 * 86_400;
  const issuedHere = issued[inv.id] ?? [];
  const decisions = [...supplierLog.entries, ...buyerLog.entries].filter((d) => d.snapshot.invoiceId?.toLowerCase() === inv.id);

  const approve = () => tx.run({ pending: "Approving invoice", done: "Invoice approved" }, (wc, account) => wc.writeContract({ address: CONFIG.book!, abi: INVOICE_BOOK_ABI, functionName: "approveInvoice", args: [inv.id], account, chain: appChain }));
  const dispute = async () => {
    setConfirmDispute(false);
    await tx.run({ pending: "Disputing invoice", done: "Invoice disputed" }, (wc, account) => wc.writeContract({ address: CONFIG.book!, abi: INVOICE_BOOK_ABI, functionName: "dispute", args: [inv.id], account, chain: appChain }));
  };
  const payOnDue = async () => {
    const allowance = await publicClient().readContract({ address: CONFIG.usdc, abi: ERC20_ABI, functionName: "allowance", args: [w.address!, CONFIG.book!] });
    if (allowance < inv.amount) {
      const ok = await tx.run({ pending: "Allowing USDC", done: "USDC allowed" }, (wc, account) => wc.writeContract({ address: CONFIG.usdc, abi: ERC20_ABI, functionName: "approve", args: [CONFIG.book!, inv.amount], account, chain: appChain }));
      if (!ok) return;
    }
    await tx.run({ pending: "Paying invoice", done: "Invoice paid" }, (wc, account) => wc.writeContract({ address: CONFIG.book!, abi: INVOICE_BOOK_ABI, functionName: "settleOnDue", args: [inv.id], account, chain: appChain }));
  };
  const askAgent = async () => {
    setAgentBusy(true);
    setAgentResult(undefined);
    try {
      const r = await fetch(`${CONFIG.supplierAgentUrl}/start/${inv.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(120_000) });
      const body = (await r.json()) as { ok: boolean; data?: { result: { kind: string; reason?: string; rateBps?: number } }; error?: { message: string } };
      setAgentResult(!body.ok ? (body.error?.message ?? "The agent refused.") : body.data!.result.kind === "accepted" ? `Accepted at ${(body.data!.result.rateBps! / 100).toFixed(2)}%.` : (body.data!.result.reason ?? body.data!.result.kind));
    } catch {
      setAgentResult("Your supplier agent could not be reached. Start it, then try again.");
    } finally {
      setAgentBusy(false);
    }
  };

  const name = invoiceName(inv.id, meta);
  const note = meta[inv.id]?.description;
  const rates = settled ? [...new Set([0, 600, 1000, settled.rateBps])].sort((a, b) => a - b) : [0, 500, 1000, 1500];

  return (
    <>
      <PageHeader
        title={name}
        lead={
          <>
            <Money minor={inv.amount} /> from <AddressChip address={inv.supplier} you={isSupplier} /> to <AddressChip address={inv.buyer} you={isBuyer} />
          </>
        }
        actions={<StatusChip status={inv.status} />}
        help={
          <>
            <p><b>This page follows one invoice from signature to payment.</b> Everything marked On-chain can be checked on the explorer by anyone.</p>
            <p><b>The curve</b> shows the <Term tip="What the buyer keeps for paying before the due date.">discount</Term> for each payment day and rate. The contract uses the same formula to the second.</p>
            <p><b>Actions</b> depend on who you are on this invoice: the supplier signs offers, the buyer approves and pays.</p>
          </>
        }
      />

      <Stepper steps={["Signed", "Registered", "Approved", "Offered", "Paid"]} current={stepIndex} />

      {inv.status === "disputed" && <Notice kind="error" title="This invoice is disputed">The buyer disputed it, so no payment can happen until it is resolved off chain. The contract will not settle it.</Notice>}

      <div className="split">
        <div style={{ display: "grid", gap: 20 }}>
          <DiscountCurve face={inv.amount} dueSec={Number(inv.dueDate)} startSec={Math.min(startSec, Number(inv.dueDate) - 86_400)} nowSec={now} rates={rates} settled={settled?.kind === "early" && chain.time(settled.block) ? { rateBps: settled.rateBps, paidSec: chain.time(settled.block)!, discount: settled.discount } : undefined} />

          <Card title="Negotiation and decisions" aside={<Tag tone="agent">agent</Tag>}>
            {decisions.length === 0 ? (
              <p className="muted">
                {supplierLog.status === "offline" && buyerLog.status === "offline"
                  ? "Neither agent is running, so there is no negotiation to show. When agents negotiate, each rung and the reason it was accepted or rejected appears here."
                  : "The agents have not made any decision about this invoice yet."}
              </p>
            ) : (
              decisions.map((d) => (
                <AgentNote key={d.hash} who={d.actor === "buyer_agent" ? "Buyer agent" : "Supplier agent"} evidence={[`outcome: ${d.outcome}`, `log ${d.hash.slice(0, 10)}…`]}>
                  <p>{d.reason}</p>
                </AgentNote>
              ))
            )}
            {issuedHere.length > 0 && (
              <>
                <p className="muted tiny">Offers signed from this browser</p>
                <ol className="timeline">
                  {issuedHere.map((o, i) => (
                    <li key={o.createdAt}>
                      <span className="rung">//r{i + 1}</span>
                      <span>{(o.rateBps / 100).toFixed(2)}% a year <Tag>human</Tag></span>
                      <span className="when">{dateTime(Math.floor(o.createdAt / 1000))}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Card>

          <Card title="Activity">
            <ol className="timeline">
              <li>
                <span className="rung">1</span>
                <span>Registered on Arc <Tag>on-chain</Tag> <TxLink hash={inv.registered.tx} /></span>
                <span className="when">{registeredAt ? dateTime(registeredAt) : "…"}</span>
              </li>
              {inv.approved && (
                <li>
                  <span className="rung">2</span>
                  <span>Approved by the buyer <Tag>on-chain</Tag> <TxLink hash={inv.approved.tx} /></span>
                  <span className="when">{dateTime(inv.approved.at)}</span>
                </li>
              )}
              {inv.disputed && (
                <li>
                  <span className="rung">!</span>
                  <span>Disputed by the buyer <Tag>on-chain</Tag> <TxLink hash={inv.disputed.tx} /></span>
                  <span className="when">{chain.time(inv.disputed.block) ? dateTime(chain.time(inv.disputed.block)!) : ""}</span>
                </li>
              )}
              {settled && (
                <li>
                  <span className="rung">✓</span>
                  <span>
                    {settled.kind === "early" ? `Paid early at ${(settled.rateBps / 100).toFixed(2)}%` : "Paid on the due date"} <Tag>on-chain</Tag> <TxLink hash={settled.tx} />
                  </span>
                  <span className="when">{chain.time(settled.block) ? dateTime(chain.time(settled.block)!) : ""}</span>
                </li>
              )}
            </ol>
          </Card>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          {settled ? (
            <Card title={settled.kind === "early" ? (settled.rateBps === 0 ? "Paid early at 0%" : "Paid early") : "Paid on the due date"}>
              <dl className="kv">
                <div><dt>Face value</dt><dd><Money minor={inv.amount} /></dd></div>
                <div><dt>Supplier received</dt><dd><Money minor={settled.net} accent /></dd></div>
                <div><dt>Discount</dt><dd><Money minor={settled.discount} /></dd></div>
                {settled.kind === "early" && <div><dt>Effective rate</dt><dd>{(Number(effectiveAprBps(settled.discount, settled.net, BigInt(Math.max(1, Number(inv.dueDate) - (chain.time(settled.block) ?? now))))) / 100).toFixed(1)}% a year</dd></div>}
                <div><dt>Success fee (paid by buyer)</dt><dd><Money minor={settled.fee} /></dd></div>
                {settled.decisionHash && <div><dt>Decision hash</dt><dd className="mono tiny">{shortId(settled.decisionHash)}</dd></div>}
              </dl>
              <p className="muted tiny"><Tag>on-chain</Tag> Net plus discount always equals the face value. The contract guarantees it.</p>
            </Card>
          ) : inv.status === "approved" ? (
            <Card title="Terms if paid now">
              <div className="quick" role="group" aria-label="Preview a rate">
                {[0, 5, 10, 15, 20].map((p) => (
                  <button key={p} type="button" className="pill-btn" aria-pressed={previewPct === p} onClick={() => setPreviewPct(p)}>{p}%</button>
                ))}
              </div>
              <dl className="kv">
                <div><dt>Days early</dt><dd>{Math.floor(Number(secs) / 86400)}</dd></div>
                <div><dt>Discount</dt><dd><Money minor={pDiscount} /></dd></div>
                <div><dt>Supplier receives</dt><dd><Money minor={inv.amount - pDiscount} accent /></dd></div>
                <div><dt>Instead of, on {dateOnly(inv.dueDate)}</dt><dd><Money minor={inv.amount} /></dd></div>
              </dl>
              <p className="muted tiny">A preview at {terms}% a year. Real terms are what the supplier signs and the buyer accepts.</p>
            </Card>
          ) : (
            <Card title="Waiting for approval">
              <p className="muted">Only an approved invoice can be paid early. The buyer approves it once the work is accepted. {dueText(inv.dueDate, now)}.</p>
              {note && isSupplier && <p className="muted tiny">Your note: {note}</p>}
            </Card>
          )}

          <Card title="What you can do">
            {w.status !== "connected" ? (
              <>
                <p className="muted">Connect your wallet to act on this invoice.</p>
                <button type="button" className="btn btn-primary" onClick={w.openModal}>Connect wallet</button>
              </>
            ) : isBuyer ? (
              inv.status === "registered" ? (
                <div className="actions-row">
                  <button type="button" className="btn btn-primary" disabled={!!tx.busy} onClick={() => void approve()}>{tx.busy ? `${tx.busy}…` : "Approve invoice"}</button>
                  <button type="button" className="btn btn-danger" disabled={!!tx.busy} onClick={() => setConfirmDispute(true)}>Dispute</button>
                </div>
              ) : inv.status === "approved" ? (
                <div className="actions-row">
                  {Number(inv.dueDate) > now && <PayEarlyButton invoice={inv} />}
                  <button type="button" className="btn btn-ghost" disabled={!!tx.busy} onClick={() => void payOnDue()}>{tx.busy ? `${tx.busy}…` : "Pay full amount"}</button>
                  <button type="button" className="btn btn-danger" disabled={!!tx.busy} onClick={() => setConfirmDispute(true)}>Dispute</button>
                </div>
              ) : (
                <p className="muted">Nothing more to do on this invoice.</p>
              )
            ) : isSupplier ? (
              inv.status === "approved" && Number(inv.dueDate) > now ? (
                <>
                  <div className="actions-row">
                    <OfferButton invoice={inv} />
                    <button type="button" className="btn btn-ghost" disabled={agentBusy} onClick={() => void askAgent()}>{agentBusy ? "Your agent is negotiating…" : "Ask my agent to negotiate"}</button>
                  </div>
                  {agentResult && <p className="muted tiny" role="status">{agentResult}</p>}
                </>
              ) : (
                <p className="muted">{inv.status === "registered" ? "Waiting for the buyer to approve." : "Nothing more to do on this invoice."}</p>
              )
            ) : (
              <p className="muted">You are not the supplier or the buyer on this invoice, so you can only read it.</p>
            )}
          </Card>

          <InviteSupplier invoice={inv} />

          <Card title="Who is involved">
            <dl className="kv">
              <div><dt>Supplier</dt><dd><AddressChip address={inv.supplier} you={isSupplier} /></dd></div>
              <div><dt>Buyer</dt><dd><AddressChip address={inv.buyer} you={isBuyer} /></dd></div>
              <div><dt>Agent identity</dt><dd className="muted">Not registered yet <Tag>erc-8004</Tag></dd></div>
              <div><dt>Reference fingerprint</dt><dd className="mono tiny">{shortId(inv.refHash)}</dd></div>
            </dl>
          </Card>
        </div>
      </div>

      <Modal open={confirmDispute} onClose={() => setConfirmDispute(false)} title="Dispute this invoice?" footer={<><button type="button" className="btn btn-ghost" onClick={() => setConfirmDispute(false)}>Cancel</button><button type="button" className="btn btn-danger" onClick={() => void dispute()}>Dispute invoice</button></>}>
        <p>Disputing blocks every payment on this invoice, early or on time, and cannot be undone on chain. Use it when the work is wrong or the invoice is not valid.</p>
      </Modal>
    </>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AgentPanel } from "@/components/app/AgentPanel";
import { useChainData } from "@/components/app/ChainData";
import { InvoiceTable } from "@/components/app/InvoiceTable";
import { PayEarlyButton } from "@/components/app/OfferFlows";
import { RequireWallet } from "@/components/app/RequireWallet";
import { AgentNote, Card, Empty, Field, Modal, Money, Notice, PageHeader, Stat, Term } from "@/components/ui/kit";
import { useToast } from "@/components/ui/toast";
import { ERC20_ABI } from "@/lib/chain/abi";
import { appChain, publicClient } from "@/lib/chain/client";
import { readBuyerState, type BuyerChainState } from "@/lib/chain/invoices";
import { CONFIG } from "@/lib/config";
import { MoneyError, formatUsd, toMinor } from "@/lib/core";
import { dateOnly, useNow } from "@/lib/format";
import { useObligations } from "@/lib/storage";
import { useTx } from "@/lib/tx";

interface PlanItem { id: string; rateBps: number; discount: string; net: string; fee: string; dueSec: string }
interface PlanResponse {
  allocation: {
    ids: string[]; totalDiscount: string; totalOutflow: string; items: PlanItem[];
    excluded: Array<{ id: string; reason: string; detail: string }>; needsApproval: string[];
    greedy: { ids: string[]; totalDiscount: string }; explanation: string; baselineBreach: boolean;
  };
  flags?: unknown[];
  settled?: Array<{ id: string; txHash?: string; transactionId?: string }>;
}

export default function BuyerDashboard() {
  return (
    <>
      <PageHeader
        title="Treasury and plan"
        lead="Your spare cash, the invoices you can pay early, and what your agent would pay first."
        actions={<PayEarlyButton />}
        help={
          <>
            <p><b>Why pay early?</b> Cash that is idle earns nothing. Paying an approved invoice sooner lets you keep a small, agreed discount. It is your own cash and your own supplier, with no outside lenders.</p>
            <p><b>Allowance.</b> The contract can only move the USDC you explicitly allow. You set the amount and can lower it any time.</p>
            <p><b>The plan.</b> With limited cash and payroll coming, the best set of invoices is not obvious. Your buyer agent searches every combination, explains why it beats the simple &quot;highest rate first&quot; choice, and never goes below your cash floor.</p>
            <p><b>Without an agent.</b> Paste a supplier&apos;s offer code and pay by hand. The contract applies the same rules.</p>
          </>
        }
      />
      <RequireWallet why="Your treasury is the wallet that pays your invoices. Connect to see it.">{(me) => <Body me={me} />}</RequireWallet>
    </>
  );
}

function Body({ me }: { me: `0x${string}` }) {
  const chain = useChainData();
  const now = useNow();
  const tx = useTx();
  const toast = useToast();
  const [state, setState] = useState<BuyerChainState | null>(null);
  const [allowOpen, setAllowOpen] = useState(false);
  const [allowAmount, setAllowAmount] = useState("10000");
  const [oblOpen, setOblOpen] = useState(false);
  const [obligations, setObligations] = useObligations();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string>();
  const [confirmRun, setConfirmRun] = useState(false);

  const load = useCallback(async () => {
    if (!CONFIG.book) return;
    try {
      setState(await readBuyerState(publicClient(), CONFIG.book, CONFIG.usdc, me));
    } catch {
      /* the banner already reports an unreachable network */
    }
  }, [me]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => !document.hidden && void load(), 10_000);
    return () => window.clearInterval(t);
  }, [load]);

  const mine = chain.invoices.filter((i) => i.buyer === me);
  const approved = mine.filter((i) => i.status === "approved");
  const owed = approved.reduce((s, i) => s + i.amount, 0n);
  const toApprove = mine.filter((i) => i.status === "registered").length;

  const allow = async () => {
    let amount: bigint;
    try {
      amount = toMinor(allowAmount);
    } catch (e) {
      return void toast.push({ kind: "error", title: "That amount is not valid", body: e instanceof MoneyError ? e.message : "Enter a number of USDC." });
    }
    const hash = await tx.run({ pending: "Setting allowance", done: "Allowance set" }, (wc, account) =>
      wc.writeContract({ address: CONFIG.usdc, abi: ERC20_ABI, functionName: "approve", args: [CONFIG.book!, amount], account, chain: appChain }),
    );
    if (hash) {
      setAllowOpen(false);
      void load();
    }
  };

  const callAgent = async (path: "plan" | "plan/execute") => {
    setPlanBusy(true);
    setPlanError(undefined);
    try {
      const r = await fetch(`${CONFIG.buyerAgentUrl}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ obligations: obligations.map((o) => ({ id: o.id, dueSec: o.dueSec, amount: o.amount })) }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = (await r.json()) as { ok: boolean; data?: PlanResponse; error?: { code: string; message: string } };
      if (!body.ok || !body.data) throw new Error(body.error ? `${body.error.code}: ${body.error.message}` : "The agent returned an error.");
      setPlan(body.data);
    } catch (e) {
      setPlanError((e as Error).name === "TypeError" ? "Your buyer agent could not be reached. Start it, then try again." : (e as Error).message);
    } finally {
      setPlanBusy(false);
      setConfirmRun(false);
    }
  };

  const spareNote = state && state.balance > 0n ? "Spare cash is what is left after your floor and upcoming payments, shown in the plan." : "Add USDC from the faucet to see a plan.";

  return (
    <>
      <div className="stats">
        <Stat label="USDC in your wallet" value={state ? <Money minor={state.balance} accent /> : "…"} hint="Read from the chain" />
        <Stat label="Contract allowance" value={state ? <Money minor={state.allowance} /> : "…"} hint={<>How much <Term tip="The contract can only move USDC you allowed. Lower it any time.">Misthos</Term> may move</>} />
        <Stat label="Owed on approved invoices" value={<Money minor={owed} />} hint={`${approved.length} invoice${approved.length === 1 ? "" : "s"}`} />
        <Stat label="Spent early today" value={state ? <Money minor={state.spentToday} /> : "…"} hint={state && state.dailyCap > 0n ? `of ${formatUsd(state.dailyCap)} daily cap` : "No daily cap set"} />
      </div>

      {toApprove > 0 && (
        <Notice kind="info" title={`${toApprove} invoice${toApprove === 1 ? " is" : "s are"} waiting for your approval`} action={<Link className="btn btn-primary btn-sm" href="/buyer/approvals">Review</Link>}>
          An invoice can only be paid early after you approve it.
        </Notice>
      )}
      {state && state.balance > 0n && state.allowance === 0n && (
        <Notice kind="warn" title="Allow the contract to pay invoices" action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setAllowOpen(true)}>Set allowance</button>}>
          Before any payment, you allow the contract to move a set amount of your USDC, once. {spareNote}
        </Notice>
      )}

      <div className="split">
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="Invoices you can pay early" aside={<Link className="link" href="/invoices">All invoices</Link>}>
            {approved.length === 0 ? (
              <Empty title="No approved invoices yet" body="When you approve an invoice from a supplier, it shows up here and can be paid early." action={<Link className="btn btn-ghost" href="/buyer/approvals">Go to approvals</Link>} />
            ) : (
              <InvoiceTable invoices={approved} me={me} side="buyer" />
            )}
          </Card>

          <Card title="Agent plan" aside={<span className="ptag ptag-agent">{"{agent}"}</span>}>
            {!plan ? (
              <>
                <p className="muted">
                  Your buyer agent looks at the offers it has received, your cash, your floor and the payments you list, then picks the set that earns the most without breaking them.
                  It only settles offers it was sent, within your policy.
                </p>
                {planError && <Notice kind="warn" title="No plan yet">{planError}</Notice>}
                <div className="actions-row">
                  <button type="button" className="btn btn-primary" disabled={planBusy} onClick={() => void callAgent("plan")}>{planBusy ? "Planning…" : "Ask my agent for a plan"}</button>
                  <span className="muted tiny">Uses your wallet balance and the obligations below.</span>
                </div>
              </>
            ) : (
              <>
                <AgentNote who="Buyer agent" evidence={[`${plan.allocation.items.length} chosen`, `${plan.allocation.excluded.length} held back`]}>
                  <p>{plan.allocation.explanation}</p>
                </AgentNote>
                {plan.allocation.items.length > 0 && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Invoice</th><th>Due</th><th className="num">Rate</th><th className="num">Discount</th><th className="num">Pay now</th></tr></thead>
                      <tbody>
                        {plan.allocation.items.map((it) => (
                          <tr key={it.id}>
                            <td><Link className="row-link" href={`/invoices/${it.id}`}>{it.id.slice(0, 8)}…</Link></td>
                            <td>{dateOnly(BigInt(it.dueSec))}</td>
                            <td className="num">{(it.rateBps / 100).toFixed(2)}%</td>
                            <td className="num"><Money minor={BigInt(it.discount)} accent /></td>
                            <td className="num"><Money minor={BigInt(it.net) + BigInt(it.fee)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {plan.allocation.excluded.length > 0 && (
                  <details className="help">
                    <summary>Why the others were not chosen</summary>
                    <div className="help-body">
                      {plan.allocation.excluded.map((x) => <p key={x.id}><b>{x.id.slice(0, 8)}…</b> {x.reason.replace(/_/g, " ").toLowerCase()}. {x.detail}</p>)}
                    </div>
                  </details>
                )}
                <div className="actions-row">
                  <button type="button" className="btn btn-primary" disabled={planBusy || plan.allocation.items.length === 0} onClick={() => setConfirmRun(true)}>Pay early ({plan.allocation.items.length})</button>
                  <button type="button" className="btn btn-ghost" disabled={planBusy} onClick={() => void callAgent("plan")}>Plan again</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setPlan(null)}>Clear</button>
                </div>
                {plan.settled && <Notice kind="ok" title={`${plan.settled.length} payment${plan.settled.length === 1 ? "" : "s"} sent`}>Check the ledger for the transaction links.</Notice>}
              </>
            )}
          </Card>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          <Card title="Allowance">
            <p className="muted">The contract can only move the USDC you allow. You can raise or lower this whenever you like.</p>
            <button type="button" className="btn btn-ghost" onClick={() => setAllowOpen(true)}>Set allowance</button>
          </Card>

          <Card title="Upcoming payments" aside={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setOblOpen(true)}>Add payment</button>}>
            <p className="muted tiny">Payroll and bills the agent must keep cash for. Saved on this device and sent to your agent only when you ask for a plan.</p>
            {obligations.length === 0 ? (
              <p className="muted">None listed. Add payroll or large bills so the plan protects your cash.</p>
            ) : (
              <ul className="checklist">
                {obligations.map((o) => (
                  <li key={o.id}>
                    <span style={{ flex: 1 }}>{o.label} <span className="muted tiny">({o.kind}, {dateOnly(BigInt(o.dueSec))})</span></span>
                    <Money minor={BigInt(o.amount)} />
                    <button type="button" className="icon-btn" onClick={() => setObligations(obligations.filter((x) => x.id !== o.id))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <AgentPanel role="buyer" url={CONFIG.buyerAgentUrl} />
        </div>
      </div>

      <Modal open={allowOpen} onClose={() => setAllowOpen(false)} title="Set allowance" footer={<><button type="button" className="btn btn-ghost" onClick={() => setAllowOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={!!tx.busy} onClick={() => void allow()}>{tx.busy ? `${tx.busy}…` : "Set allowance"}</button></>}>
        <p className="muted">How much USDC may the contract move from your wallet, in total? Choose what you are comfortable with. Setting it to 0 turns payments off.</p>
        <Field label="Amount (USDC)" htmlFor="allow">
          <input id="allow" className="input" inputMode="decimal" value={allowAmount} onChange={(e) => setAllowAmount(e.target.value)} />
          <div className="quick">{["1000", "10000", "100000", "0"].map((v) => <button key={v} type="button" className="pill-btn" aria-pressed={allowAmount === v} onClick={() => setAllowAmount(v)}>{v === "0" ? "Off" : formatUsd(toMinor(v), 0)}</button>)}</div>
        </Field>
      </Modal>

      <ObligationModal open={oblOpen} onClose={() => setOblOpen(false)} onAdd={(o) => { setObligations([...obligations, o]); setOblOpen(false); }} now={now} />

      <Modal open={confirmRun} onClose={() => setConfirmRun(false)} title="Pay these invoices early?" footer={<><button type="button" className="btn btn-ghost" onClick={() => setConfirmRun(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={planBusy} onClick={() => void callAgent("plan/execute")}>{planBusy ? "Sending…" : "Pay early"}</button></>}>
        <p>Your agent will settle the {plan?.allocation.items.length ?? 0} invoice(s) shown, for <Money minor={BigInt(plan?.allocation.totalOutflow ?? "0")} accent /> in total, using the offers it holds. Each payment is a transaction from your agent wallet and cannot be undone.</p>
      </Modal>
    </>
  );
}

function ObligationModal({ open, onClose, onAdd, now }: { open: boolean; onClose(): void; onAdd(o: { id: string; label: string; amount: string; dueSec: string; kind: "payroll" | "bill" | "other" }): void; now: number }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(new Date((now + 14 * 86_400) * 1000).toISOString().slice(0, 10));
  const [kind, setKind] = useState<"payroll" | "bill" | "other">("payroll");
  let minor: bigint | null = null;
  try { minor = toMinor(amount); } catch { minor = null; }
  const ok = label.trim().length > 0 && minor !== null && minor > 0n && !Number.isNaN(Date.parse(due));
  return (
    <Modal open={open} onClose={onClose} title="Add an upcoming payment" footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={!ok} onClick={() => ok && onAdd({ id: crypto.randomUUID(), label: label.trim(), amount: minor!.toString(), dueSec: String(Math.floor(Date.parse(`${due}T12:00:00Z`) / 1000)), kind })}>Add payment</button></>}>
      <Field label="What is it?" htmlFor="o-label"><input id="o-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="October payroll" /></Field>
      <Field label="Amount (USDC)" htmlFor="o-amt" error={amount && minor === null ? "Use a number with up to 6 decimals." : undefined}><input id="o-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="4000" /></Field>
      <Field label="Due" htmlFor="o-due"><input id="o-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <Field label="Type" htmlFor="o-kind"><select id="o-kind" className="select input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="payroll">Payroll</option><option value="bill">Bill</option><option value="other">Other</option></select></Field>
    </Modal>
  );
}

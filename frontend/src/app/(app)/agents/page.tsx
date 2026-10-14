"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Agents as AgentsShowcase } from "@/components/landing/Agents";
import { AddressChip, Card, CopyButton, Empty, Notice, PageHeader, Skeleton, Tag, TxLink } from "@/components/ui/kit";
import { api, apiEnabled } from "@/lib/api";

/**
 * The public agent log. Every decision an agent makes is added to its own hash chain, signed by the agent's wallet and
 * checked again by the server. This page shows that proof: the chain and the signatures re-verified on each load, and for
 * every decision that paid an invoice, the on-chain transaction that carries the same hash.
 */

interface VerifyData {
  ok: boolean;
  count: number;
  known: string[];
  agents: Array<{ signer: string; actor: "supplier_agent" | "buyer_agent"; count: number; chainOk: boolean; signaturesOk: boolean; ok: boolean; badIndex: number | null }>;
}
interface LogItem {
  seq: number;
  actor: "supplier_agent" | "buyer_agent";
  signer: string;
  invoiceRef: string;
  outcome: "auto_apply" | "needs_approval" | "rejected";
  reasonCode: string | null;
  reason: string;
  at: number;
  hash: string;
  prevHash: string;
  signature: string;
  /** From the entry's snapshot: the policy it ran under and what it decided. Null for entries written before policies were versioned. */
  policyVersion?: string | null;
  result?: string | null;
  snapshot: unknown;
  settlement: { txHash: string; block: string } | null;
}
interface LogPage {
  total: number;
  items: LogItem[];
}

const PAGE = 25;
const ROLE: Record<LogItem["actor"], string> = { supplier_agent: "Supplier agent", buyer_agent: "Buyer agent" };
const OUTCOME: Record<LogItem["outcome"], { label: string; tone: "ok" | "warn" | "bad" }> = {
  auto_apply: { label: "Acted", tone: "ok" },
  needs_approval: { label: "Needs a person", tone: "warn" },
  rejected: { label: "Declined", tone: "bad" },
};
const short = (h: string, a = 10, b = 6) => `${h.slice(0, a)}…${h.slice(-b)}`;
const isInvoice = (r: string) => /^0x[0-9a-fA-F]{64}$/.test(r);

const REASONS: Array<[string, string]> = [
  ["BELOW_HURDLE", "The offered rate is under the buyer's private minimum. The minimum itself is never revealed."],
  ["LIQUIDITY_FLOOR", "Paying would take the buyer's cash under the floor it keeps."],
  ["NOT_ELIGIBLE", "The invoice is not approved, is already due, or the offer breaks a cap."],
  ["NEEDS_HUMAN_APPROVAL", "The payment is above the amount the buyer signs off personally, so a person decides."],
  ["EXPIRED", "The offer ran out of time before it was accepted."],
  ["DISPUTED", "The buyer disputed the invoice."],
  ["REPUTATION_FLAG", "A record of past behaviour blocks early payment."],
];

export default function AgentLog() {
  const [verify, setVerify] = useState<{ status: "loading" } | { status: "unavailable"; reason: string } | { status: "ready"; data: VerifyData }>({ status: "loading" });
  const [log, setLog] = useState<{ status: "loading" } | { status: "unavailable"; reason: string } | { status: "ready"; items: LogItem[]; total: number }>({ status: "loading" });
  const [more, setMore] = useState(false);

  const load = useCallback(async (offset: number) => {
    const r = await api<LogPage>(`/api/log?limit=${PAGE}&offset=${offset}`);
    if (!r.ok) return setLog({ status: "unavailable", reason: r.error.message });
    setLog((prev) => ({ status: "ready", total: r.data.total, items: offset === 0 || prev.status !== "ready" ? r.data.items : [...prev.items, ...r.data.items] }));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const [v] = await Promise.all([api<VerifyData>("/api/log/verify"), load(0)]);
      if (!live) return;
      setVerify(v.ok ? { status: "ready", data: v.data } : { status: "unavailable", reason: v.error.message });
    })();
    return () => {
      live = false;
    };
  }, [load]);

  return (
    <>
      <PageHeader
        title="Agent log"
        lead="Every decision the two agents make, with proof. Each entry is chained to the one before it, signed by the agent's own wallet, and re-checked by the server."
        help={
          <>
            <p><b>What you are looking at.</b> Each business runs its own agent. Whenever an agent decides something (to offer, to accept, to decline, to wait for a person) it writes a line to a log that cannot be edited without breaking every line after it.</p>
            <p><b>How to check it yourself.</b> Each entry shows its hash. When an entry paid an invoice, the same hash is stored in the payment transaction on Arc: open that transaction and compare. The server recomputes the chain and every signature each time this page loads, so a changed line shows up here as a failure.</p>
            <p><b>What it never contains.</b> Private numbers (a buyer&apos;s minimum rate, a supplier&apos;s cost of waiting) and free text from invoices never go into a log entry.</p>
          </>
        }
      />

      {!apiEnabled && <Notice kind="info" title="Unavailable: this site is not connected to a Misthos server">The log is read from the server, so there is nothing to show until it is connected.</Notice>}

      {apiEnabled && (
      <section className="grid-2" aria-label="Verification">
        {verify.status === "loading" && <Card title="Verification"><Skeleton rows={2} /></Card>}
        {verify.status === "unavailable" && (
          <Card title="Verification"><p className="muted">Unavailable: {verify.reason}</p></Card>
        )}
        {verify.status === "ready" && <Verification data={verify.data} />}
      </section>
      )}

      {apiEnabled && (
      <Card title="Decisions" aside={log.status === "ready" ? <span className="muted tiny">{log.total} in total</span> : undefined}>
        {log.status === "loading" && <Skeleton rows={4} />}
        {log.status === "unavailable" && <p className="muted">Unavailable: {log.reason}</p>}
        {log.status === "ready" && log.items.length === 0 && (
          <Empty title="No decisions logged yet" body="When an agent makes its first decision, it appears here with its proof." />
        )}
        {log.status === "ready" && log.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table log-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Agent</th>
                    <th>Invoice</th>
                    <th>Decision</th>
                    <th>Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {log.items.map((e) => (
                    <Row key={e.hash} e={e} />
                  ))}
                </tbody>
              </table>
            </div>
            {log.items.length < log.total && (
              <div className="actions-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={more}
                  onClick={async () => {
                    setMore(true);
                    await load(log.items.length);
                    setMore(false);
                  }}
                >
                  {more ? "Loading" : `Show ${Math.min(PAGE, log.total - log.items.length)} more`}
                </button>
              </div>
            )}
          </>
        )}
      </Card>
      )}

      <Card title="How the agents talk">
        <ol className="timeline">
          <li><span className="rung">1</span><span>The supplier agent signs an offer, starting at 0%, and sends it.</span><span className="when">signed</span></li>
          <li><span className="rung">2</span><span>The buyer agent checks the signature, the invoice and its own rules.</span><span className="when">code</span></li>
          <li><span className="rung">3</span><span>It either pays at that rate, or answers with a reason code and never the number behind it.</span><span className="when">signed</span></li>
          <li><span className="rung">4</span><span>If rejected, the supplier signs the next rung, a little higher, up to its own limit.</span><span className="when">≤ 6 rungs</span></li>
        </ol>
        <details className="help">
          <summary>The seven reason codes</summary>
          <div className="help-body">{REASONS.map(([c, d]) => <p key={c}><b className="mono">{c}</b> {d}</p>)}</div>
        </details>
        <p className="muted tiny">An AI model may suggest where to start and what to flag, but it can never sign or send anything. Plain code checks every number and the contract has the final say. To run your own agent, see <Link className="link" href="/docs/run-the-agents">Run the agents</Link>.</p>
      </Card>

      <AgentsShowcase compact />
    </>
  );
}

function Verification({ data }: { data: VerifyData }) {
  const seen = new Set(data.agents.map((a) => a.signer));
  const silent = data.known.filter((k) => !seen.has(k));
  return (
    <>
      {data.agents.map((a) => (
        <Card
          key={a.signer}
          title={ROLE[a.actor]}
          aside={
            <span className="health">
              <span className="dot" data-ok={String(a.ok)} aria-hidden="true" />
              {a.ok ? "Verified" : "Does not verify"}
            </span>
          }
        >
          <dl className="kv">
            <div><dt>Wallet</dt><dd><AddressChip address={a.signer} /></dd></div>
            <div><dt>Entries</dt><dd>{a.count}</dd></div>
            <div><dt>Hash chain</dt><dd>{a.chainOk ? "Intact: every entry links to the one before" : a.badIndex !== null ? `Broken at entry ${a.badIndex}` : "Broken"}</dd></div>
            <div><dt>Signatures</dt><dd>{a.signaturesOk ? "Every entry is signed by this wallet" : "At least one signature does not match"}</dd></div>
          </dl>
        </Card>
      ))}
      {silent.map((k) => (
        <Card key={k} title="Agent" aside={<span className="health"><span className="dot" data-ok="unknown" aria-hidden="true" />No entries yet</span>}>
          <dl className="kv">
            <div><dt>Wallet</dt><dd><AddressChip address={k} /></dd></div>
            <div><dt>Entries</dt><dd>0</dd></div>
          </dl>
          <p className="muted tiny">This wallet is one of this deployment&apos;s agents. Nothing to verify until it logs a decision.</p>
        </Card>
      ))}
      {data.agents.length === 0 && silent.length === 0 && (
        <Card title="Verification"><p className="muted">No agent wallet is configured on the server, so there is nothing to verify.</p></Card>
      )}
    </>
  );
}

function Row({ e }: { e: LogItem }) {
  const [open, setOpen] = useState(false);
  const o = OUTCOME[e.outcome];
  // Salted commitments to the agent's private policy and inputs. They prove which policy and inputs a decision used, to anyone the owner shows the values to, and reveal nothing otherwise.
  const snap = (e.snapshot && typeof e.snapshot === "object" ? e.snapshot : {}) as Record<string, unknown>;
  const commitments: Array<[string, string]> = [];
  if (typeof snap.policyCommitment === "string") commitments.push(["Policy commitment", snap.policyCommitment]);
  if (typeof snap.inputsCommitment === "string") commitments.push(["Inputs commitment", snap.inputsCommitment]);
  return (
    <>
      <tr>
        <td className="nowrap">
          {new Date(e.at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          <br />
          <span className="muted tiny">{new Date(e.at * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
        </td>
        <td>
          <Tag tone={e.actor === "buyer_agent" ? "agent" : undefined}>{ROLE[e.actor]}</Tag>
        </td>
        <td>{isInvoice(e.invoiceRef) ? <Link className="row-link mono" href={`/invoices/${e.invoiceRef}`}>{short(e.invoiceRef, 8, 6)}</Link> : <span className="muted">{e.invoiceRef === "plan" ? "Payment plan" : e.invoiceRef}</span>}</td>
        <td className="log-reason">
          <span className="log-outcome" data-tone={o.tone}>
            <span aria-hidden="true">{o.tone === "ok" ? "✓" : o.tone === "warn" ? "!" : "✕"}</span> {o.label}
          </span>
          <span className="log-text">{e.reason}</span>
          {e.policyVersion && <span className="muted tiny">Policy {e.policyVersion}</span>}
        </td>
        <td className="log-proof">
          <span className="mono-link">
            <span className="mono" title={e.hash}>{short(e.hash)}</span>
            <CopyButton text={e.hash} />
          </span>
          {e.settlement ? (
            <span className="log-settled">Paid on Arc: <TxLink hash={e.settlement.txHash} /></span>
          ) : null}
          <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide details" : "Details"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="log-detail">
          <td colSpan={5}>
            <dl className="kv">
              <div><dt>Entry</dt><dd>#{e.seq} in this agent&apos;s chain</dd></div>
              <div><dt>Previous hash</dt><dd className="mono tiny">{e.prevHash}</dd></div>
              <div><dt>This hash</dt><dd className="mono tiny">{e.hash}</dd></div>
              <div><dt>Signed by</dt><dd><AddressChip address={e.signer} /></dd></div>
              <div><dt>Signature</dt><dd className="mono tiny">{short(e.signature, 18, 10)}</dd></div>
              <div><dt>Policy in force</dt><dd>{e.policyVersion ?? "Not recorded (written before policies were versioned)"}</dd></div>
              {commitments.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono tiny">{short(v, 18, 10)}</dd></div>)}
              <div><dt>Inputs it saw</dt><dd><pre className="log-json">{JSON.stringify(e.snapshot, null, 2)}</pre></dd></div>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

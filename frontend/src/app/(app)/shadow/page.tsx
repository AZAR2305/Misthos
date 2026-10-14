"use client";

import { useMemo, useState } from "react";
import { Card, Field, Money, Notice, PageHeader, Tag } from "@/components/ui/kit";
import { SHADOW_LABEL, formatMinor, parseDateSec, parseInvoicesCsv, parseObligationsCsv, shadowReport, shadowToCsv, shadowToMarkdown, toMinor, type RowError, type ShadowReport } from "@/lib/core";

/**
 * Shadow mode: what a buyer's agent WOULD do with your real invoices and cash. Everything runs in this browser tab with the same decision code the
 * agents use. Nothing you type is sent anywhere or saved: close the tab and it is gone. No funds move and nothing is signed.
 */
const today = () => new Date().toISOString().slice(0, 10);
const EXAMPLE = "counterparty,amount,due_date,approved_date,offer_rate_pct\nSupplier A,2500,2026-11-20,2026-10-12,\nSupplier B,1200,2026-11-05,2026-10-10,4";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Shadow() {
  const [asOf, setAsOf] = useState(today);
  const [cash, setCash] = useState("");
  const [floor, setFloor] = useState("");
  const [hurdle, setHurdle] = useState("0");
  const [invoices, setInvoices] = useState("");
  const [obligations, setObligations] = useState("");
  const [dueCounts, setDueCounts] = useState(true);
  const [run, setRun] = useState<{ report?: ShadowReport; errors: RowError[]; fields: string[] } | null>(null);

  const compute = () => {
    const fields: string[] = [];
    const nowSec = parseDateSec(asOf);
    if (nowSec === undefined) fields.push("The as-of date must be a real date.");
    let cashM = 0n;
    let floorM = 0n;
    try {
      cashM = toMinor(cash);
    } catch {
      fields.push("Cash must be a USDC amount, for example 12000 or 12000.50.");
    }
    try {
      floorM = floor.trim() === "" ? 0n : toMinor(floor);
    } catch {
      fields.push("The liquidity floor must be a USDC amount, or empty for none.");
    }
    const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(hurdle.trim());
    const hurdleBps = m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0") : NaN;
    if (!Number.isFinite(hurdleBps) || hurdleBps > 5000) fields.push("The hurdle is a yearly percentage from 0 to 50, with at most two decimals.");
    const inv = parseInvoicesCsv(invoices, nowSec ?? 0n);
    const obl = parseObligationsCsv(obligations);
    const errors = [...inv.errors.map((e) => ({ ...e, message: `Invoices, line ${e.line}: ${e.message}` })), ...obl.errors.map((e) => ({ ...e, message: `Upcoming payments, line ${e.line}: ${e.message}` }))];
    if (fields.length || errors.length || nowSec === undefined) return setRun({ errors, fields });
    // The policy numbers stay in this function and in this tab. They are used to decide and are never written into the report.
    const report = shadowReport({
      nowSec,
      cash: cashM,
      policy: { hurdleAprBps: hurdleBps, liquidityFloor: floorM, perInvoiceCap: 0n, dailyCap: 0n, humanAbove: 0n, feeBps: 1000 },
      invoices: inv.rows,
      obligations: obl.rows,
      includeUnselectedDue: dueCounts,
    });
    setRun({ report, errors: [], fields: [] });
  };

  const r = run?.report;
  const stamp = useMemo(() => (r ? new Date(Number(r.asOfSec) * 1000).toISOString().slice(0, 10) : ""), [r]);

  return (
    <>
      <PageHeader
        title="Shadow report"
        lead="See what a buyer's agent would do with your real invoices and cash, with no wallet and no money moving."
        help={
          <>
            <p><b>What this is.</b> A calculation on the numbers you enter. It runs the same decision code the agents run, in this browser tab.</p>
            <p><b>What it is not.</b> It does not pay anything, sign anything or touch the chain, and it does not count as activity on {`the network`}. A real settlement needs a wallet.</p>
            <p><b>Privacy.</b> Nothing you type leaves this tab and nothing is saved. Your cash, floor and hurdle are used to decide and are never written into the report you download.</p>
          </>
        }
      />

      <Notice kind="info" title={SHADOW_LABEL}>
        Everything below is computed in your browser. Nothing is uploaded or stored. Counterparty names stay on this page and are never sent to a model.
      </Notice>

      <div className="split">
        <div style={{ display: "grid", gap: 20 }}>
          <Card title="Your numbers">
            <div className="grid-2">
              <Field label="As of" htmlFor="sh-asof" hint="The report treats this as today."><input id="sh-asof" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} placeholder="YYYY-MM-DD" /></Field>
              <Field label="Cash you hold (USDC)" htmlFor="sh-cash"><input id="sh-cash" className="input" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /></Field>
              <Field label="Cash you always keep (USDC)" htmlFor="sh-floor" hint="The liquidity floor. Empty means none."><input id="sh-floor" className="input" inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} /></Field>
              <Field label="Return you need to pay early (% a year)" htmlFor="sh-hurdle" hint="0 if the cash sits idle. About what it would otherwise earn."><input id="sh-hurdle" className="input" inputMode="decimal" value={hurdle} onChange={(e) => setHurdle(e.target.value)} /></Field>
            </div>
            <label className="check" style={{ display: "flex", gap: 8, margin: "8px 0" }}>
              <input type="checkbox" checked={dueCounts} onChange={(e) => setDueCounts(e.target.checked)} />
              <span>Count my unpaid invoices as payments that fall due <span className="muted tiny">(recommended; it is how your agent protects your cash)</span></span>
            </label>
          </Card>

          <Card title="Your invoices (CSV)" aside={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setInvoices(EXAMPLE)}>Show the format</button>}>
            <p className="muted tiny">Columns: counterparty, amount (USDC), due_date (YYYY-MM-DD), approved_date (empty if not approved yet), and optionally offer_rate_pct. At most 20 invoices. If a row has no offer rate, the report assumes your hurdle.</p>
            <textarea id="sh-invoices" className="input" rows={8} style={{ fontFamily: "var(--font-mono)" }} value={invoices} onChange={(e) => setInvoices(e.target.value)} aria-label="Invoices as CSV" />
          </Card>

          <Card title="Your upcoming payments (CSV, optional)">
            <p className="muted tiny">Payroll, rent, bills: columns label, amount, due_date. They are cash your agent must keep.</p>
            <textarea id="sh-obligations" className="input" rows={4} style={{ fontFamily: "var(--font-mono)" }} value={obligations} onChange={(e) => setObligations(e.target.value)} aria-label="Upcoming payments as CSV" />
          </Card>

          <button type="button" className="btn btn-primary" onClick={compute}>Compute the shadow report</button>
        </div>

        <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
          {run && (run.fields.length > 0 || run.errors.length > 0) && (
            <Notice kind="error" title="Fix these first. Nothing was computed.">
              <ul>
                {run.fields.map((f) => <li key={f}>{f}</li>)}
                {run.errors.map((e, i) => <li key={i}>{e.message}</li>)}
              </ul>
            </Notice>
          )}

          {r && (
            <Card title={`Shadow report as of ${stamp}`} aside={<Tag>shadow</Tag>}>
              <p><b>{SHADOW_LABEL}</b></p>
              <p>
                Your agent would pay <b>{r.totals.accelerated}</b> of {r.totals.accelerated + r.totals.held} invoices early, {r.totals.avgDaysGained} days early on average, and hold {r.totals.held}.
              </p>
              <dl className="kv">
                <div><dt>Face value paid early</dt><dd><Money minor={r.totals.face} accent /></dd></div>
                <div><dt>You would earn in discount</dt><dd><Money minor={r.totals.discount} /></dd></div>
                <div><dt>Platform fee</dt><dd><Money minor={r.totals.fee} /></dd></div>
                <div><dt>Suppliers keep versus factoring</dt><dd><Money minor={r.totals.supplierKeepsVsFactoring} /></dd></div>
              </dl>
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead><tr><th>#</th><th>Counterparty</th><th>Decision</th><th>Rate</th><th>Days early</th><th>Face</th><th>Why held</th></tr></thead>
                  <tbody>
                    {r.lines.map((l) => (
                      <tr key={l.line}>
                        <td>{l.line}</td>
                        <td>{l.counterparty}</td>
                        <td>{l.decision === "accelerate" ? "Pay early" : "Hold"}</td>
                        <td>{(l.rateBps / 100).toFixed(2)}%</td>
                        <td>{l.daysGained}</td>
                        <td>{formatMinor(l.face)}</td>
                        <td className="muted tiny">{l.reason ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted tiny">{r.best.explanation}</p>
              <details>
                <summary>What this assumes</summary>
                <ul>{r.assumptions.map((a) => <li key={a} className="muted tiny">{a}</li>)}</ul>
              </details>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => download(`shadow-report-${stamp}.csv`, shadowToCsv(r), "text/csv")}>Download CSV</button>
                <button type="button" className="btn btn-ghost" onClick={() => download(`shadow-report-${stamp}.md`, shadowToMarkdown(r), "text/markdown")}>Download Markdown</button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

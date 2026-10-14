"use client";

import { useMemo, useState } from "react";
import { useChainData } from "@/components/app/ChainData";
import { Card, Empty, Money, PageHeader, Skeleton, Stat, Tag, Term, TxLink } from "@/components/ui/kit";
import { CONFIG } from "@/lib/config";
import { formatUsd } from "@/lib/core";
import { dateOnly, shortId } from "@/lib/format";
import { ORIGINS, type Origin } from "@/lib/origins";
import { REGISTRY } from "@/lib/origins-registry";
import { headline, ofOrigin, settlementRows, summarise, type SettlementRow } from "@/lib/stats";

/** Public traction numbers, recomputed from chain events in your browser. Nothing is typed in. */
const LABEL: Record<Origin, string> = { pilot: "Independent pilots", team: "Team runs", unverified: "Unverified" };

export default function Stats() {
  const chain = useChainData();
  // One origin at a time, never added together. The default is the one that counts as traction: independent pilots with a written note.
  const [origin, setOrigin] = useState<Origin>("pilot");
  const everything = useMemo(() => settlementRows(chain.invoices, chain.time, REGISTRY), [chain.invoices, chain]);
  const rows = useMemo(() => ofOrigin(everything, origin), [everything, origin]);
  const counts = useMemo(() => Object.fromEntries(ORIGINS.map((o) => [o, ofOrigin(everything, o).length])) as Record<Origin, number>, [everything]);
  const s = useMemo(() => summarise(rows), [rows]);
  const open = chain.invoices.filter((i) => i.status === "registered" || i.status === "approved").length;

  return (
    <>
      <PageHeader
        title="Live stats"
        lead={chain.status === "ready" ? headline(s) : chain.status === "unconfigured" ? "Nothing to count yet: the contract is not deployed on this network." : "Reading the chain…"}
        help={
          <>
            <p><b>Where the numbers come from.</b> Your browser reads the contract&apos;s events straight from {CONFIG.networkName} and does the arithmetic itself. There is no server in between and no typed-in figure. Every settlement links to the explorer so you can check it.</p>
            <p><b>How we count.</b> An invoice counts once it is <Term tip="Paid before its due date through the contract.">paid early</Term>. &quot;Days early&quot; is the whole days between payment and the due date. The annual rate is the discount over the cash paid and the time skipped.</p>
            <p><b>What this does not show yet.</b> All activity on this network is counted together. Separating real pilot invoices from the team&apos;s own test runs needs the backend, which is not built, so treat these as testnet activity.</p>
          </>
        }
      />
      <div role="tablist" aria-label="Where the activity comes from" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        {ORIGINS.map((o) => (
          <button key={o} type="button" role="tab" aria-selected={origin === o} className={origin === o ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} onClick={() => setOrigin(o)}>
            {LABEL[o]} ({counts[o]})
          </button>
        ))}
      </div>
      <p className="muted tiny">
        <Tag>testnet</Tag> {origin === "pilot" ? "Independent pilots only: businesses with a written independence note in the repo. This is the only view that counts as traction." : origin === "team" ? "Runs by wallets the build team controls. A demonstration, not traction, and never added to the pilot numbers." : "Activity from wallets nobody has documented. Real or not, it is not counted until someone does."}
      </p>

      {chain.status === "loading" ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <div className="stats">
            <Stat label="Paid early" value={s.count} hint="Invoices" />
            <Stat label="Cash moved" value={<Money minor={s.net} accent />} hint="Paid to suppliers, in USDC" />
            <Stat label="Median days early" value={s.medianDaysEarly ?? "n/a"} hint="Before the due date" />
            <Stat label="Cleared at 0%" value={s.zeroSharePct === null ? "n/a" : `${s.zeroSharePct}%`} hint="Paid early for nothing" />
            <Stat label="Buyer yield" value={s.weightedAprBps === null ? "n/a" : `${(Number(s.weightedAprBps) / 100).toFixed(1)}%`} hint="Annualised" />
            <Stat label="Still open" value={open} hint="Registered or approved" />
          </div>

          {rows.length === 0 ? (
            <Empty title={origin === "pilot" ? "No independent pilot yet" : "Nothing here yet"} body={origin === "pilot" ? "No business outside the build team has settled an invoice yet, so this is empty on purpose. Team runs and unverified activity are under the other tabs, labelled." : "When an invoice of this kind is paid early, this page shows how many days it saved and what it cost."} />
          ) : (
            <>
              <Card title="Wait before and after">
                <Dumbbell rows={rows.slice(0, 12)} />
                <p className="muted tiny">Each row is one invoice. The hollow dot is the day it was due; the filled dot is the day it was paid. The line between them is time the supplier did not wait.</p>
              </Card>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Invoice</th><th className="num">Amount</th><th>Paid</th><th className="num">Days early</th><th className="num">Rate</th><th className="num">Discount</th><th>Transaction</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 25).map((r) => (
                      <tr key={r.tx}>
                        <td className="mono tiny">{shortId(r.id)}</td>
                        <td className="num"><Money minor={r.face} /></td>
                        <td>{dateOnly(r.paidSec)}</td>
                        <td className="num">{r.daysEarly}</td>
                        <td className="num">{r.rateBps === 0 ? "0%" : `${(r.rateBps / 100).toFixed(2)}%`}</td>
                        <td className="num"><Money minor={r.discount} /></td>
                        <td><TxLink hash={r.tx} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted tiny">Total discount {formatUsd(s.discount)} · success fees {formatUsd(s.fee)} · last updated {chain.updatedAt ? new Date(chain.updatedAt).toLocaleTimeString() : "…"}</p>
            </>
          )}
        </>
      )}
    </>
  );
}

function Dumbbell({ rows }: { rows: SettlementRow[] }) {
  const w = 680;
  const rowH = 30;
  const m = { l: 96, r: 20, t: 12, b: 28 };
  const min = Math.min(...rows.map((r) => r.paidSec));
  const max = Math.max(...rows.map((r) => r.dueSec));
  const span = Math.max(1, max - min);
  const x = (t: number) => m.l + ((t - min) / span) * (w - m.l - m.r);
  const h = m.t + rows.length * rowH + m.b;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Paid date against due date for each invoice" className="curve" style={{ border: 0, padding: 0 }}>
      {rows.map((r, i) => {
        const y = m.t + i * rowH + rowH / 2;
        return (
          <g key={r.tx}>
            <text x={m.l - 10} y={y + 4} textAnchor="end">{shortId(r.id).slice(0, 10)}</text>
            <line x1={x(r.paidSec)} x2={x(r.dueSec)} y1={y} y2={y} stroke="var(--accent-dim)" strokeWidth={3} strokeLinecap="round" />
            <circle cx={x(r.paidSec)} cy={y} r={5.5} fill="var(--accent)" />
            <circle cx={x(r.dueSec)} cy={y} r={5.5} fill="var(--color-bg)" stroke="var(--color-text-muted)" strokeWidth={2} />
          </g>
        );
      })}
      <text x={m.l} y={h - 8}>{dateOnly(min)}</text>
      <text x={w - m.r} y={h - 8} textAnchor="end">{dateOnly(max)}</text>
    </svg>
  );
}

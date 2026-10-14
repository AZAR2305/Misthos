"use client";

import { useMemo } from "react";
import { CONFIG } from "@/lib/config";
import { Notice, Skeleton, Tag, TxLink } from "@/components/ui/kit";
import type { InvoiceLogState } from "@/lib/invoicelog";
import { dateTime } from "@/lib/format";
import { axisMax, barPosition, buildTrace, type TraceRung } from "@/lib/trace";

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

/**
 * The negotiation for one invoice, rung by rung, from the signed decision log (SRS view C). Every row is something an agent
 * logged, with the fixed text for the code it logged. The bar shows where the offers fell and where the deal was reached.
 * It never draws the other side's limits: the log never contains them, so there is nothing here to leak.
 */
export function NegotiationTrace({ log, settledTx }: { log: InvoiceLogState; settledTx?: string }) {
  const trace = useMemo(() => buildTrace(log.entries), [log.entries]);

  if (log.status === "loading") return <Skeleton rows={2} />;
  const nothing = trace.rungs.length === 0 && !trace.ladder && !trace.noDeal && trace.waiting.length === 0;
  if (nothing) {
    return (
      <>
        <p className="muted">
          No decision has been logged about this invoice yet. When the agents negotiate, each rung and the reason it was accepted or rejected appears here, signed by the agent that made it.
        </p>
        {log.notes.map((n) => <p key={n} className="muted tiny">{n}</p>)}
      </>
    );
  }

  return (
    <div className="trace">
      {trace.ladder && <p className="muted tiny">The supplier agent opened a ladder of {trace.ladder.count} rung{trace.ladder.count === 1 ? "" : "s"} starting at {pct(trace.ladder.startBps)} a year. Where it would stop is its own business and is never published.</p>}

      {trace.rungs.length > 0 && <RangeBar rungs={trace.rungs} />}

      {trace.rungs.length > 0 && (
        <ol className="timeline trace-rows">
          {trace.rungs.map((r) => (
            <li key={r.hash} data-accepted={r.accepted}>
              <span className="rung">{r.rung === null ? "//" : `//r${r.rung + 1}`}</span>
              <span>
                <b>{pct(r.rateBps)} a year</b>: <span className="trace-reply" data-accepted={r.accepted}>{r.text}</span>
                {r.credit && (
                  <span className="muted tiny trace-credit">
                    {" "}Credit check: {r.credit.result === "ok" ? "inside the limit" : "over the limit"} ({r.credit.version}; {r.credit.evidenceCount} on-chain record{r.credit.evidenceCount === 1 ? "" : "s"})
                  </span>
                )}
                {r.reputation && (
                  <span className="muted tiny trace-credit">
                    {" "}<Tag tone="agent">erc-8004</Tag>{" "}
                    {r.reputation.result === "read" ? `Supplier's agent: ${r.reputation.recentCount} recent rating${r.reputation.recentCount === 1 ? "" : "s"}, ${r.reputation.recentDisputed} disputed` : r.reputation.result === "none" ? "Supplier's agent: no ratings yet, so a new-address cap applies" : "The registry could not be read, so a person decides"}
                    {" "}(read by the buyer's agent from the registry at <a className="source" href={`${CONFIG.explorer}/address/0x8004B663056A597Dffe9eCcC1965A193B7388713`} target="_blank" rel="noreferrer">0x8004B663…8713</a>)
                  </span>
                )}
              </span>
              <span className="when trace-proof">
                {r.signed ? <Tag>signed</Tag> : <Tag>not delivered yet</Tag>} <span className="mono">{r.hash.slice(0, 10)}…</span>
                {r.policyVersion && <span> {r.policyVersion}</span>}
                {r.at ? <span> {dateTime(r.at)}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}

      {trace.noDeal && (
        <Notice kind="info" title="No deal">
          {trace.noDeal.text} Nothing was paid and the invoice stays on its normal terms.
        </Notice>
      )}
      {trace.waiting.length > 0 && (
        <Notice kind="warn" title="Waiting for a person">
          <ul className="trace-wait">
            {trace.waiting.map((w) => <li key={w.hash}>{w.actor === "buyer_agent" ? "Buyer agent" : "Supplier agent"}: {w.text}</li>)}
          </ul>
        </Notice>
      )}

      <p className="muted tiny">
        Each decision was made by code{trace.policyVersions.length ? ` under ${trace.policyVersions.join(" and ")}` : ""}; the model only suggested. A signed entry was checked by the server (hash, chain and signature).
        {settledTx && <> The accepting decision is the one on the settlement transaction: <TxLink hash={settledTx} />.</>}
        {!log.fromApi && " This list comes from an agent on this machine because the public log could not be read."}
      </p>
      {log.notes.map((n) => <p key={n} className="muted tiny">{n}</p>)}
    </div>
  );
}

function RangeBar({ rungs }: { rungs: TraceRung[] }) {
  const max = axisMax(rungs.map((r) => r.rateBps));
  const summary = rungs.map((r) => `${pct(r.rateBps)} ${r.accepted ? "accepted" : "rejected"}`).join(", ");
  return (
    <div className="range" role="img" aria-label={`Rates offered, from lowest to highest: ${summary}`}>
      <div className="range-track">
        {rungs.map((r) => (
          <span key={r.hash} className="range-mark" data-accepted={r.accepted} style={{ left: `${barPosition(r.rateBps, max)}%` }} title={`${pct(r.rateBps)}: ${r.text}`} />
        ))}
      </div>
      <div className="range-axis" aria-hidden="true">
        <span>0%</span>
        <span>{pct(max / 2)}</span>
        <span>{pct(max)} a year</span>
      </div>
    </div>
  );
}

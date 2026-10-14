"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, Money, Notice, Skeleton, Tag, TxLink } from "@/components/ui/kit";
import { EVIDENCE_LABEL, useExposureHistory, useExposurePolicy } from "@/lib/exposure";
import { evaluateExposure } from "@/lib/core";
import { useNow } from "@/lib/format";
import { newExposureFor } from "@/lib/exposure";

/**
 * The basis of the credit limit for one counterparty (SRS view B): what is allowed, what is outstanding, what is left, and the
 * settlements it rests on, each with its transaction. It runs the same pure function the agents run, on public chain history
 * and the owner's own saved limits, so it shows what an agent would decide. Nothing is estimated: a value that cannot be read
 * says unavailable, and with no limit set it says so rather than assuming one.
 */
export function CreditBasis({ side, owner, counterparty, invoiceId, face }: { side: "supplier" | "buyer"; owner?: string; counterparty: string; invoiceId: string; face: bigint }) {
  const policy = useExposurePolicy();
  const history = useExposureHistory(side, owner, counterparty);
  const now = useNow();
  const settingsHref = side === "buyer" ? "/buyer/policy" : "/supplier/policy";

  const decision = useMemo(() => {
    if (policy.status !== "ready" || !policy.policy || history.status !== "ready") return undefined;
    // An invoice already counted as outstanding is not a second commitment.
    return evaluateExposure({ side, nowSec: BigInt(now), newExposure: newExposureFor(side, invoiceId, face, history.events), events: history.events, policy: policy.policy });
  }, [policy, history, side, now, face, invoiceId]);

  const what = side === "buyer" ? "pay early to this supplier" : "be owed by this buyer";
  const faceLabel = side === "buyer" ? "This invoice at full price (0% rate)" : "This invoice";

  return (
    <Card title="Credit limit for this business" aside={<Tag>policy</Tag>}>
      {policy.status === "loading" || history.status === "loading" ? (
        <Skeleton rows={3} />
      ) : policy.status === "signed-out" ? (
        <Notice kind="info" title="Sign in to see your limit" action={<Link className="btn btn-ghost btn-sm" href="/login">Sign in</Link>}>
          Your credit limits are saved on your account. Until you sign in they cannot be shown.
        </Notice>
      ) : policy.status === "unavailable" ? (
        <Notice kind="warn" title="Unavailable">Your credit limit could not be read: {policy.reason}</Notice>
      ) : policy.policy === null ? (
        <Notice kind="info" title="No credit limit set" action={<Link className="btn btn-ghost btn-sm" href={settingsHref}>Set limits</Link>}>
          Nobody is given credit by default. Until you set a limit, your agent makes no credit check, and says so in its log.
        </Notice>
      ) : history.status === "unavailable" ? (
        <Notice kind="warn" title="Unavailable">The history with this business could not be read: {history.reason}. Your agent would accept nothing until it can.</Notice>
      ) : decision && decision.kind === "decided" ? (
        <>
          <p className="muted tiny">How much you will {what}, from your saved limits ({policy.policy.version}) and what Arc shows between you.</p>
          <dl className="kv">
            <div><dt>Allowed limit</dt><dd><Money minor={decision.allowed} accent /> <Tag>policy</Tag></dd></div>
            <div><dt>Outstanding now</dt><dd><Money minor={decision.outstanding} /> <Tag>on-chain</Tag></dd></div>
            <div><dt>Room left</dt><dd><Money minor={decision.room} /></dd></div>
            <div><dt>{faceLabel}</dt><dd><Money minor={face} /></dd></div>
            <div>
              <dt>Verdict</dt>
              <dd>
                {decision.ok ? (
                  <span className="chip" data-tone="ok"><span aria-hidden="true">✓</span> Fits the limit</span>
                ) : (
                  <span className="chip" data-tone="bad"><span aria-hidden="true">!</span> Over by <Money minor={decision.newExposure + decision.outstanding - decision.allowed} /></span>
                )}
              </dd>
            </div>
          </dl>
          {!decision.ok && side === "buyer" && <p className="muted tiny">A higher rate lowers what you pay, so an offer at a higher rate may still fit. Your range above shows the lowest rate your agent accepts.</p>}
          {decision.evidence.length === 0 ? (
            <p className="muted tiny">No settled invoices with this business yet, so the limit is your starting limit for a new counterparty. Settled invoices raise it.</p>
          ) : (
            <>
              <p className="muted tiny">The limit rests on these invoices. Each settlement is counted once, and only with a transaction behind it.</p>
              <ul className="checklist credit-evidence">
                {decision.evidence.map((e, i) => (
                  <li key={`${e.ref}-${e.kind}-${i}`}>
                    <span style={{ flex: 1 }}>{EVIDENCE_LABEL[e.kind] ?? e.kind} <span className="muted tiny mono">{e.ref.slice(0, 10)}…</span></span>
                    <Money minor={e.amount} />
                    {e.txHash ? <TxLink hash={e.txHash} /> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <Notice kind="warn" title="Unavailable">The history needed for the limit is unavailable.</Notice>
      )}
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Field, Notice, Tag, Term } from "@/components/ui/kit";
import { MoneyError, formatMinor, toMinor } from "@/lib/core";
import { bpsToPercent, percentToBps, useExposurePolicy } from "@/lib/exposure";

const trim = (minor: bigint) => formatMinor(minor).replace(/\.?0+$/, "") || "0";

/**
 * The owner's credit limits (SRS FR-05), saved on their account and versioned. Unknown businesses get the starting limit, which
 * starts at zero, so nobody is given credit until the owner decides. Every change makes a new version; decisions already made
 * stay tied to the version they ran under.
 */
export function ExposurePolicyCard({ side }: { side: "supplier" | "buyer" }) {
  const p = useExposurePolicy();
  const [start, setStart] = useState("");
  const [max, setMax] = useState("");
  const [growth, setGrowth] = useState("20");
  const [lookback, setLookback] = useState("180");
  const [grace, setGrace] = useState("1");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string>();
  const [failed, setFailed] = useState<string>();

  const current = p.status === "ready" ? p.policy : undefined;
  useEffect(() => {
    if (!current) return;
    setStart(trim(current.newCounterpartyLimit));
    setMax(trim(current.maxLimit));
    setGrowth(bpsToPercent(current.growthBps));
    setLookback(String(current.lookbackDays));
    setGrace(String(Math.round(current.graceSeconds / 86_400)));
  }, [current]);

  const money = (v: string): { ok: true; minor: bigint } | { ok: false; error: string } => {
    try {
      return { ok: true, minor: toMinor(v || "0") };
    } catch (e) {
      return { ok: false, error: e instanceof MoneyError ? "Use a number with up to 6 decimals." : "Enter a number." };
    }
  };
  const s = money(start);
  const m = money(max);
  const g = percentToBps(growth);
  const lb = /^\d{1,3}$/.test(lookback) ? Number(lookback) : NaN;
  const gr = /^\d{1,2}$/.test(grace) ? Number(grace) : NaN;
  const maxBelow = s.ok && m.ok && m.minor < s.minor;
  const errors = {
    start: !s.ok ? s.error : undefined,
    max: !m.ok ? m.error : maxBelow ? "The maximum cannot be lower than the starting limit." : undefined,
    growth: g === undefined ? "Use a percentage from 0 to 100, with up to 2 decimals." : undefined,
    lookback: !(lb >= 1 && lb <= 730) ? "Use 1 to 730 days." : undefined,
    grace: !(gr >= 0 && gr <= 30) ? "Use 0 to 30 days." : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  const submit = async () => {
    setTouched(true);
    setSaved(undefined);
    setFailed(undefined);
    if (!valid || !s.ok || !m.ok || g === undefined) return;
    setBusy(true);
    const err = await p.save({ newCounterpartyLimit: s.minor.toString(), maxLimit: m.minor.toString(), growthBps: g, lookbackDays: lb, graceSeconds: gr * 86_400 });
    setBusy(false);
    if (err) setFailed(err);
    else setSaved("Saved.");
  };

  const what = side === "buyer" ? "pay early to one supplier" : "be owed by one buyer";

  return (
    <Card title="Credit limits" aside={<Tag>policy</Tag>}>
      {p.status === "loading" ? (
        <p className="muted">Loading…</p>
      ) : p.status === "signed-out" ? (
        <Notice kind="info" title="Sign in to set your limits" action={<Link className="btn btn-ghost btn-sm" href="/login">Sign in</Link>}>
          Credit limits are saved on your account so your agent can read them. They are private to you.
        </Notice>
      ) : p.status === "unavailable" ? (
        <Notice kind="warn" title="Unavailable">Your credit limits cannot be read or saved right now: {p.reason}</Notice>
      ) : (
        <>
          <p className="muted">
            How much you will {what}, at most. A business you have not dealt with gets the starting limit. Each invoice it settles through Arc raises its limit by the percentage below, up to your maximum.
          </p>
          {p.policy === null && <Notice kind="info" title="No limits set yet">Until you save limits, nobody is given credit and your agent makes no credit check.</Notice>}
          <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
            <Field label="Starting limit for a new business (USDC)" htmlFor="xp-start" error={touched ? errors.start : undefined} hint="0 means no credit until you raise it.">
              <input id="xp-start" className="input" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Maximum limit (USDC)" htmlFor="xp-max" error={touched ? errors.max : undefined} hint="The ceiling, whatever the history says.">
              <input id="xp-max" className="input" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </Field>
            <Field label="Growth per settled invoice (%)" htmlFor="xp-growth" error={touched ? errors.growth : undefined} hint={<>Added to the limit as a share of the <Term tip="Only invoices settled on Arc with a transaction behind them. Each counts once.">verified volume</Term>.</>}>
              <input id="xp-growth" className="input" inputMode="decimal" value={growth} onChange={(e) => setGrowth(e.target.value)} />
            </Field>
            <Field label="Look-back (days)" htmlFor="xp-look" error={touched ? errors.lookback : undefined} hint="Only settlements this recent count.">
              <input id="xp-look" className="input" inputMode="numeric" value={lookback} onChange={(e) => setLookback(e.target.value)} />
            </Field>
            <Field label="Days past due before an invoice is called overdue" htmlFor="xp-grace" error={touched ? errors.grace : undefined} hint="Overdue is not fraud: the invoice stays owed and stops adding to the limit, nothing more.">
              <input id="xp-grace" className="input" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
            </Field>
            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save limits"}</button>
              {current && <span className="muted tiny">In force: {current.version}</span>}
            </div>
            {saved && <p className="muted tiny" role="status">{saved} A change makes a new version; decisions already made stay tied to the version they ran under.</p>}
            {failed && <p className="muted tiny" role="alert">Not saved: {failed}</p>}
          </form>
        </>
      )}
    </Card>
  );
}

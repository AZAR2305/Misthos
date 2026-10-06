"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { useChainData } from "@/components/app/ChainData";
import { PayEarlyButton } from "@/components/app/OfferFlows";
import { Card, CopyButton, Field, Money, Notice } from "@/components/ui/kit";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { InvoiceRecord } from "@/lib/chain/invoices";
import { discountOf } from "@/lib/core";
import { dateOnly } from "@/lib/format";
import { encodeOfferCode, offerCodeSchema } from "@/lib/offers";

/** What the server keeps about a claim link. The link itself is never stored, so it cannot be shown again. */
export interface StandingOffer {
  id: string;
  invoiceId: string;
  rateBps: number;
  expiresAt: string;
  status: "open" | "claimed" | "expired" | "withdrawn";
  supplier: string;
  claimedAt: string | null;
  signedOffer: unknown;
}

const useBuyerAccount = () => {
  const acct = useAccount();
  return acct.mode === "on" && acct.me?.step === "ready" && acct.me.side === "buyer";
};

/** A buyer invites the supplier to be paid early with one link. No account is needed on the supplier's side. */
export function InviteSupplier({ invoice }: { invoice: InvoiceRecord }) {
  const eligible = useBuyerAccount();
  const toast = useToast();
  const [ratePct, setRatePct] = useState("0");
  const [hours, setHours] = useState("72");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ claimUrl: string; expiresAt: string } | null>(null);
  if (!eligible || invoice.status !== "approved") return null;

  const rateOk = /^\d{1,2}(\.\d{1,2})?$/.test(ratePct) && Math.round(parseFloat(ratePct) * 100) <= 5000;
  const rateBps = rateOk ? Math.round(parseFloat(ratePct) * 100) : 0;
  const hrs = /^\d{1,3}$/.test(hours) ? Number(hours) : 0;
  const secs = BigInt(Math.max(0, Number(invoice.dueDate) - Math.floor(Date.now() / 1000)));
  const discount = discountOf(invoice.amount, rateBps, secs);

  const create = async () => {
    setBusy(true);
    const r = await api<{ claimUrl: string; expiresAt: string }>("/api/standing-offers", { method: "POST", body: { invoiceId: invoice.id, rateBps, validHours: hrs } });
    setBusy(false);
    if (!r.ok) return void toast.push({ kind: "error", title: "The link was not created", body: r.error.message });
    setMade(r.data);
    toast.push({ kind: "success", title: "Claim link created" });
  };

  return (
    <Card title="Invite the supplier to be paid early" aside={<span className="muted tiny">No account needed</span>}>
      {made ? (
        <>
          <Notice kind="ok" title="Send this link to the supplier">
            It works once and is shown only now: Misthos keeps a fingerprint, not the link. It expires {dateOnly(Math.floor(new Date(made.expiresAt).getTime() / 1000))}.
          </Notice>
          <div className="code-wrap">
            <span className="code" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{made.claimUrl}</span>
            <CopyButton text={made.claimUrl} label="Copy link" />
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            Offer a rate you are happy to pay, often 0%. The supplier opens the link, sees exactly what they get, and signs with the wallet this invoice already names. You then review and pay in one click.
          </p>
          <div className="grid-2">
            <Field label="Yearly rate (%)" htmlFor="claim-rate" error={rateOk ? undefined : "Use 0 to 50, up to two decimals."} hint="0 means the supplier is simply paid early.">
              <input id="claim-rate" className="input" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
            </Field>
            <Field label="Link stays open (hours)" htmlFor="claim-hours" error={hrs >= 1 && hrs <= 168 ? undefined : "Between 1 and 168 hours."}>
              <input id="claim-hours" className="input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
          </div>
          {rateOk && (
            <p className="muted tiny">
              Today the supplier would receive <Money minor={invoice.amount - discount} accent /> instead of <Money minor={invoice.amount} /> on {dateOnly(Number(invoice.dueDate))}.
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !rateOk || hrs < 1 || hrs > 168} onClick={() => void create()}>
            {busy ? "Creating…" : "Create claim link"}
          </button>
        </>
      )}
    </Card>
  );
}

const STATUS_TEXT: Record<StandingOffer["status"], string> = { open: "Waiting for the supplier", claimed: "Signed: ready to pay", expired: "Expired", withdrawn: "Declined or withdrawn" };

/** All of this buyer's claim links, and the one-click way to pay the ones a supplier has signed. */
export function ClaimLinksCard() {
  const eligible = useBuyerAccount();
  const chain = useChainData();
  const toast = useToast();
  const [rows, setRows] = useState<StandingOffer[] | null>(null);

  const load = useCallback(async () => {
    const r = await api<StandingOffer[]>("/api/standing-offers");
    if (r.ok) setRows(r.data);
  }, []);
  useEffect(() => {
    if (!eligible) return;
    void load();
    const t = window.setInterval(() => !document.hidden && void load(), 10_000);
    return () => window.clearInterval(t);
  }, [eligible, load]);

  if (!eligible) return null;
  const withdraw = async (id: string) => {
    const r = await api(`/api/standing-offers/${id}`, { method: "DELETE" });
    if (!r.ok) return void toast.push({ kind: "error", title: "Could not withdraw", body: r.error.message });
    void load();
  };

  return (
    <Card title="Claim links" aside={<span className="muted tiny">Suppliers you invited</span>}>
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">None yet. Open an approved invoice and choose “Invite the supplier” to create one.</p>
      ) : (
        <ul className="claim-list">
          {rows.map((r) => {
            const parsed = r.status === "claimed" ? offerCodeSchema.safeParse(r.signedOffer) : null;
            const invoice = chain.invoices.find((i) => i.id === r.invoiceId);
            return (
              <li key={r.id}>
                <div>
                  <Link href={`/invoices/${r.invoiceId}`} className="mono">{r.invoiceId.slice(0, 10)}…{r.invoiceId.slice(-4)}</Link>
                  <span className="muted tiny"> · {(r.rateBps / 100).toFixed(2)}% a year</span>
                </div>
                <span className="chip" data-status={r.status}>{STATUS_TEXT[r.status]}</span>
                <div className="claim-actions">
                  {r.status === "open" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void withdraw(r.id)}>Withdraw</button>}
                  {parsed?.success && invoice?.status === "approved" && <PayEarlyButton invoice={invoice} initialCode={encodeOfferCode(parsed.data)} label="Review and pay" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

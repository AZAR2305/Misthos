"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { WalletCards } from "@/components/app/Gate";
import { AddressChip, Card, Money, Notice, PageHeader, Skeleton } from "@/components/ui/kit";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/components/wallet/WalletProvider";
import { api, apiEnabled } from "@/lib/api";
import { publicClient } from "@/lib/chain/client";
import { discountOf, domain, offerTypedData } from "@/lib/core";
import { dateOnly } from "@/lib/format";
import { randomNonce } from "@/lib/offers";
import { friendlyError } from "@/lib/tx";

interface OpenClaim {
  status: "open";
  now: number;
  invoice: { id: `0x${string}`; amount: string; dueDate: string; buyer: `0x${string}`; supplier: `0x${string}` };
  offer: { rateBps: number; expiresAt: string };
  chain: { id: number; book: `0x${string}` | null };
}
type Claim = OpenClaim | { status: "claimed" | "expired" | "withdrawn" } | { status: "unavailable"; reason: string };

const CLOSED: Record<string, string> = {
  claimed: "This link was already used. The buyer has the signed offer and will review and pay it.",
  expired: "This offer has expired. Ask the buyer for a new link.",
  withdrawn: "This offer was declined or withdrawn.",
};

/**
 * The page a supplier lands on from a claim link. No account is needed: the link proves the buyer's invitation, and the wallet
 * the invoice already names proves the supplier. Money moves only when the buyer then reviews and pays, so signing here is
 * safe and free. Every figure comes from the server and the chain; nothing is shown that could not be verified.
 */
export default function Claim() {
  const { token } = useParams<{ token: string }>();
  const w = useWallet();
  const toast = useToast();
  const [claim, setClaim] = useState<Claim | null | "missing" | "offline">(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);

  const load = useCallback(async () => {
    if (!apiEnabled) return setClaim("offline");
    const r = await api<Claim>(`/api/claims/${encodeURIComponent(token)}`);
    if (r.ok) setClaim(r.data);
    else setClaim(r.error.code === "NOT_FOUND" ? "missing" : "offline");
  }, [token]);
  useEffect(() => void load(), [load]);

  const open = claim && typeof claim === "object" && claim.status === "open" ? claim : null;
  const mine = !!open && w.status === "connected" && w.address === open.invoice.supplier;

  const accept = async () => {
    if (!open || !w.walletClient || !w.address || !open.chain.book) return;
    setBusy(true);
    try {
      const expiry = BigInt(Math.floor(new Date(open.offer.expiresAt).getTime() / 1000));
      const offer = { invoiceId: open.invoice.id, rateBps: open.offer.rateBps, expiry, nonce: randomNonce() };
      const td = offerTypedData(domain(open.chain.id, open.chain.book), offer);
      const signature = await w.walletClient.signTypedData({ account: w.address, ...td });
      const ok = await publicClient().verifyTypedData({ address: w.address, ...td, signature }).catch(() => true);
      if (!ok) throw new Error("The signature did not verify against your address.");
      const r = await api(`/api/claims/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        body: { offer: { invoiceId: offer.invoiceId, rateBps: offer.rateBps, expiry: expiry.toString(), nonce: offer.nonce.toString() }, signature },
      });
      if (!r.ok) throw new Error(r.error.message);
      setDone("signed");
      toast.push({ kind: "success", title: "Offer signed", body: "The buyer can now review and pay it." });
    } catch (e) {
      toast.push({ kind: "error", title: "That did not go through", body: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    const r = await api(`/api/claims/${encodeURIComponent(token)}/decline`, { method: "POST", body: {} });
    setBusy(false);
    if (r.ok) setDone("declined");
    else toast.push({ kind: "error", title: "Could not decline", body: r.error.message });
  };

  const secs = open ? BigInt(Math.max(0, Number(open.invoice.dueDate) - open.now)) : 0n;
  const amount = open ? BigInt(open.invoice.amount) : 0n;
  const discount = open ? discountOf(amount, open.offer.rateBps, secs) : 0n;

  return (
    <>
      <PageHeader
        title="Get paid early"
        lead="A buyer sent you this link so you can be paid before the due date. You do not need an account."
        help={
          <>
            <p><b>What happens.</b> You check the terms below and sign with the wallet this invoice already names. Signing sends no transaction and costs nothing. The buyer then reviews and pays you in USDC.</p>
            <p><b>Why it is safe.</b> The link works once and expires. The money can only go to the address shown here, which was fixed when the invoice was created, so a forwarded link cannot redirect it.</p>
          </>
        }
      />

      {claim === null && <Skeleton rows={4} />}
      {claim === "offline" && (
        <Notice kind="error" title="This link cannot be checked right now">
          {apiEnabled ? "The Misthos server did not answer. Try again in a moment." : "This site is not connected to a Misthos server, so claim links cannot be verified here."} No amounts are shown rather than guessing.
        </Notice>
      )}
      {claim === "missing" && (
        <Notice kind="warn" title="This link is not valid">
          Check that you copied the whole link. If it still fails, ask the buyer to send a new one.
        </Notice>
      )}
      {claim && typeof claim === "object" && claim.status !== "open" && (
        <Notice kind="info" title="This offer is closed">
          {claim.status === "unavailable" ? claim.reason : CLOSED[claim.status]}
        </Notice>
      )}

      {open && !done && (
        <>
          <Card title="The offer">
            <dl className="kv claim-terms">
              <div><dt>Invoice</dt><dd><Money minor={amount} /> due {dateOnly(Number(open.invoice.dueDate))}</dd></div>
              <div><dt>You receive now</dt><dd className="claim-big"><Money minor={amount - discount} accent /></dd></div>
              <div><dt>Instead of waiting {Math.floor(Number(secs) / 86400)} days</dt><dd>{discount === 0n ? "No discount: you are simply paid early." : <>A discount of <Money minor={discount} /> ({(open.offer.rateBps / 100).toFixed(2)}% a year)</>}</dd></div>
              <div><dt>Offer open until</dt><dd>{new Date(open.offer.expiresAt).toLocaleString()}</dd></div>
            </dl>
          </Card>

          <Card title="Where the money goes">
            <p className="muted">Payment goes to this address and no other. Check that it is yours before you sign.</p>
            <AddressChip address={open.invoice.supplier} />
            <p className="muted tiny">From the buyer <AddressChip address={open.invoice.buyer} />.</p>
          </Card>

          <Card title="Sign to accept">
            {w.status !== "connected" ? (
              <>
                <p className="muted">Connect the wallet that owns the address above.</p>
                <WalletCards />
              </>
            ) : !mine ? (
              <Notice kind="warn" title="This is not the wallet this invoice pays">
                You are connected as <span className="mono">{w.address?.slice(0, 6)}…{w.address?.slice(-4)}</span>. Switch to <span className="mono">{open.invoice.supplier.slice(0, 6)}…{open.invoice.supplier.slice(-4)}</span> in your wallet, or ask the buyer to check the invoice.
              </Notice>
            ) : (
              <>
                {!w.onRightNetwork && <Notice kind="warn" title="Wrong network">Switch your wallet to the network this site uses first.</Notice>}
                <div className="actions-row">
                  <button type="button" className="btn btn-primary" disabled={busy || !w.onRightNetwork} onClick={() => void accept()}>{busy ? "Check your wallet…" : "Accept and sign"}</button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void decline()}>Decline</button>
                </div>
                <p className="muted tiny">Declining leaves the invoice on its normal terms.</p>
              </>
            )}
          </Card>
        </>
      )}

      {done === "signed" && open && (
        <Notice kind="ok" title="Signed. The buyer has been sent your offer">
          They review it and pay you in USDC; you will see it arrive in your wallet. You can follow it on <Link href={`/invoices/${open.invoice.id}`}>the invoice page</Link>.
        </Notice>
      )}
      {done === "declined" && <Notice kind="info" title="Declined">The invoice stays on its normal terms. Nothing was sent.</Notice>}

      <Card title="Keep your link private">
        <p className="muted">Treat a claim link like cash. Do not forward it. Even then, it can only ever pay the address shown above.</p>
      </Card>
    </>
  );
}

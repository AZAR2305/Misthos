"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, toHex } from "viem";
import { useChainData } from "@/components/app/ChainData";
import { CopyButton, Field, Modal, Money, Notice, Tag } from "@/components/ui/kit";
import { useToast } from "@/components/ui/toast";
import { useSignerCheck } from "@/components/account/AccountProvider";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ERC20_ABI, INVOICE_BOOK_ABI } from "@/lib/chain/abi";
import { appChain, publicClient } from "@/lib/chain/client";
import { readBuyerState, type BuyerChainState, type InvoiceRecord } from "@/lib/chain/invoices";
import { CONFIG } from "@/lib/config";
import { canonicalJson, discountOf, domain, effectiveAprBps, feeOf, offerTypedData } from "@/lib/core";
import { dateOnly } from "@/lib/format";
import { decodeOfferCode, encodeOfferCode, offerToContract, randomNonce, type OfferCode } from "@/lib/offers";
import { saveIssuedOffer } from "@/lib/storage";
import { friendlyError, useTx } from "@/lib/tx";

/* ------------------------------------------------------------------ supplier: sign an offer */

/** The supplier names a rate and signs it. The code can be handed to the buyer: the contract enforces it. */
export function OfferButton({ invoice }: { invoice: InvoiceRecord }) {
  const w = useWallet();
  const toast = useToast();
  const signerProblem = useSignerCheck();
  const [open, setOpen] = useState(false);
  const [ratePct, setRatePct] = useState("0");
  const [hours, setHours] = useState("48");
  const [code, setCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const nowSec = Math.floor(Date.now() / 1000);

  const rateBps = useMemo(() => {
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(ratePct)) return null;
    const bps = Math.round(parseFloat(ratePct) * 100);
    return bps >= 0 && bps <= 5000 ? bps : null;
  }, [ratePct]);
  const hrs = /^\d{1,3}$/.test(hours) ? Number(hours) : 0;
  const hoursOk = hrs >= 1 && hrs <= 168 && nowSec + hrs * 3600 < Number(invoice.dueDate);
  const secs = BigInt(Math.max(0, Number(invoice.dueDate) - nowSec));
  const discount = rateBps === null ? 0n : discountOf(invoice.amount, rateBps, secs);
  const net = invoice.amount - discount;

  const sign = async () => {
    if (rateBps === null || !hoursOk || !w.walletClient || !w.address || !CONFIG.book) return;
    const problem = signerProblem();
    if (problem) return void toast.push({ kind: "error", title: "Wrong wallet", body: problem });
    setBusy(true);
    try {
      const d = domain(CONFIG.chainId, CONFIG.book);
      const offer = { invoiceId: invoice.id, rateBps, expiry: BigInt(nowSec + hrs * 3600), nonce: randomNonce() };
      const td = offerTypedData(d, offer);
      const sig = await w.walletClient.signTypedData({ account: w.address, ...td });
      const ok = await publicClient().verifyTypedData({ address: w.address, ...td, signature: sig }).catch(() => false);
      if (!ok) throw new Error("The signature did not verify against your address.");
      const text = encodeOfferCode({
        v: 1,
        chainId: CONFIG.chainId,
        book: CONFIG.book,
        supplier: w.address,
        offer: { invoiceId: offer.invoiceId, rateBps, expiry: offer.expiry.toString(), nonce: offer.nonce.toString() },
        sig,
      });
      saveIssuedOffer(invoice.id, text, rateBps);
      setCode(text);
      toast.push({ kind: "success", title: "Offer signed", body: "Send the offer code to the buyer." });
    } catch (e) {
      toast.push({ kind: "error", title: "Signing did not go through", body: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => { setCode(undefined); setOpen(true); }}>
        Sign an early-payment offer
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Offer early payment">
        {!code ? (
          <>
            <p className="muted">
              Choose the most the buyer may keep for paying you early, as a yearly rate. <b>0% means you are paid the full amount, early, for nothing.</b> The buyer can accept
              at or below this rate, never above it, and only once.
            </p>
            <Field label="Rate (percent per year)" htmlFor="rate" hint="Start low. 0 to 50." error={rateBps === null ? "Enter a rate between 0 and 50, with up to two decimals." : undefined}>
              <input id="rate" className="input" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
              <div className="quick">{["0", "5", "10", "15", "20"].map((p) => <button key={p} type="button" className="pill-btn" aria-pressed={ratePct === p} onClick={() => setRatePct(p)}>{p}%</button>)}</div>
            </Field>
            <Field label="Offer is valid for (hours)" htmlFor="hours" hint="After this the offer expires and cannot be used." error={hoursOk ? undefined : "Use 1 to 168 hours, ending before the due date."}>
              <input id="hours" className="input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
            {rateBps !== null && (
              <div className="preview">
                <p>If the buyer pays now at the top rate you receive <Money minor={net} accent /> instead of <Money minor={invoice.amount} /> on {dateOnly(invoice.dueDate)}.</p>
                <p className="muted tiny">That is a discount of <Money minor={discount} />{discount > 0n ? <> ({(Number(effectiveAprBps(discount, net, secs)) / 100).toFixed(1)}% a year to the buyer)</> : null}. Paying later shrinks it.</p>
              </div>
            )}
            <div className="modal-foot" style={{ padding: 0, border: 0 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || rateBps === null || !hoursOk} onClick={() => void sign()}>
                {busy ? "Waiting for your signature…" : "Sign offer"}
              </button>
            </div>
          </>
        ) : (
          <>
            <Notice kind="ok" title="Offer signed">Nothing was sent anywhere. Give this code to the buyer so they can pay you.</Notice>
            <div className="code-wrap">
              <span className="code" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{code}</span>
              <CopyButton text={code} label="Copy code" />
            </div>
            <p className="muted tiny">Only the buyer on this invoice can use it, once, before it expires. Never above the rate you chose.</p>
            <div className="modal-foot" style={{ padding: 0, border: 0 }}><button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Done</button></div>
          </>
        )}
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------------- buyer: pay early */

interface Check {
  offer: OfferCode;
  invoice: InvoiceRecord;
  problems: string[];
  terms?: { secs: bigint; discount: bigint; net: bigint; fee: bigint; outflow: bigint };
  state?: BuyerChainState;
  feeBps?: number;
}

/** Everything the buyer should know before paying, read from the chain. A problem blocks the button. */
async function checkOffer(code: OfferCode, me: `0x${string}`, invoices: readonly InvoiceRecord[], only?: string): Promise<{ ok: false; error: string } | { ok: true; check: Check }> {
  if (!CONFIG.book) return { ok: false, error: "The contract is not deployed on this network." };
  if (code.chainId !== CONFIG.chainId || code.book.toLowerCase() !== CONFIG.book.toLowerCase()) return { ok: false, error: "This offer is for a different network or contract." };
  const invoice = invoices.find((i) => i.id === code.offer.invoiceId.toLowerCase());
  if (!invoice) return { ok: false, error: "That invoice is not on this network yet. Reload in a moment." };
  if (only && invoice.id !== only.toLowerCase()) return { ok: false, error: "This offer is for a different invoice." };
  const problems: string[] = [];
  if (invoice.buyer !== me.toLowerCase()) problems.push("You are not the buyer on this invoice. Switch to the buyer's wallet.");
  if (invoice.status !== "approved") problems.push("The invoice must be approved before it can be paid early.");
  if (invoice.supplier !== code.supplier.toLowerCase()) problems.push("The offer was not signed by this invoice's supplier.");
  const nowSec = Math.floor(Date.now() / 1000);
  if (BigInt(code.offer.expiry) < BigInt(nowSec)) problems.push("This offer has expired. Ask the supplier for a new one.");
  if (Number(invoice.dueDate) <= nowSec) problems.push("The invoice is already due, so there is nothing to pay early.");

  const client = publicClient();
  const d = domain(CONFIG.chainId, CONFIG.book);
  const td = offerTypedData(d, { invoiceId: code.offer.invoiceId as `0x${string}`, rateBps: code.offer.rateBps, expiry: BigInt(code.offer.expiry), nonce: BigInt(code.offer.nonce) });
  try {
    const valid = await client.verifyTypedData({ address: invoice.supplier, ...td, signature: code.sig as `0x${string}` });
    if (!valid) problems.push("The signature is not valid for the supplier's wallet.");
    const used = await client.readContract({ address: CONFIG.book, abi: INVOICE_BOOK_ABI, functionName: "usedOfferNonce", args: [invoice.supplier, BigInt(code.offer.nonce)] });
    if (used) problems.push("This offer was already used.");
    const [feeBps, feeRecipient, state] = await Promise.all([
      client.readContract({ address: CONFIG.book, abi: INVOICE_BOOK_ABI, functionName: "feeBps" }),
      client.readContract({ address: CONFIG.book, abi: INVOICE_BOOK_ABI, functionName: "feeRecipient" }),
      readBuyerState(client, CONFIG.book, CONFIG.usdc, me),
    ]);
    const secs = BigInt(Math.max(0, Number(invoice.dueDate) - nowSec));
    const discount = discountOf(invoice.amount, code.offer.rateBps, secs);
    const net = invoice.amount - discount;
    const fee = /^0x0{40}$/.test(feeRecipient) ? 0n : feeOf(discount, feeBps);
    const outflow = net + fee;
    if (state.balance < outflow) problems.push("Your wallet does not hold enough USDC for this payment.");
    if (state.perInvoiceCap > 0n && outflow > state.perInvoiceCap) problems.push("This is above your per-invoice cap. Raise it on the policy page.");
    if (state.dailyCap > 0n && state.spentToday + outflow > state.dailyCap) problems.push("This would go over your daily cap.");
    return { ok: true, check: { offer: code, invoice, problems, terms: { secs, discount, net, fee, outflow }, state, feeBps } };
  } catch (e) {
    return { ok: false, error: `Could not check the offer against the chain: ${friendlyError(e)}` };
  }
}

/** The buyer pastes an offer code, sees exactly what will happen, and pays. */
export function PayEarlyButton({ invoice, label = "Pay early with an offer code", initialCode }: { invoice?: InvoiceRecord; label?: string; initialCode?: string }) {
  const w = useWallet();
  const chain = useChainData();
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initialCode ?? "");
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkOffer>> | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setResult(null);
    if (!text.trim() || !w.address) return;
    const dec = decodeOfferCode(text);
    if (!dec.ok) return void setResult({ ok: false, error: dec.error });
    let live = true;
    setChecking(true);
    void checkOffer(dec.value, w.address, chain.invoices, invoice?.id).then((r) => {
      if (live) {
        setResult(r);
        setChecking(false);
      }
    });
    return () => {
      live = false;
    };
  }, [text, w.address, chain.invoices, invoice?.id]);

  const check = result?.ok ? result.check : undefined;
  const needsAllowance = !!check?.terms && !!check.state && check.state.allowance < check.terms.outflow;

  const approve = async () => {
    if (!check?.terms) return;
    await tx.run({ pending: "Allowing USDC", done: "USDC allowed" }, (wc, account) =>
      wc.writeContract({ address: CONFIG.usdc, abi: ERC20_ABI, functionName: "approve", args: [CONFIG.book!, check.terms!.outflow * 2n], account, chain: appChain }),
    );
    setText((t) => t + " "); // re-run the checks with the new allowance
  };

  const pay = async () => {
    if (!check) return;
    // A human decision still has a hash: it ties this payment to who decided and which offer it was.
    const decisionHash = keccak256(toHex(canonicalJson({ actor: "human", invoiceId: check.invoice.id, offerNonce: check.offer.offer.nonce })));
    const hash = await tx.run({ pending: "Paying early", done: "Paid early" }, (wc, account) =>
      wc.writeContract({
        address: CONFIG.book!,
        abi: INVOICE_BOOK_ABI,
        functionName: "settleEarly",
        args: [check.invoice.id, offerToContract(check.offer.offer), check.offer.sig as `0x${string}`, decisionHash],
        account,
        chain: appChain,
      }),
    );
    if (hash) {
      await chain.refresh();
      setOpen(false);
      setText("");
    }
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => (w.status === "connected" ? setOpen(true) : w.openModal())}>{label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Pay early with an offer">
        <p className="muted">Paste the offer code the supplier gave you. You will see the exact price before anything is sent.</p>
        <Field label="Offer code" htmlFor="offer-code" error={result && !result.ok ? result.error : undefined}>
          <textarea id="offer-code" className="textarea mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="misthos-offer-1:…" spellCheck={false} />
        </Field>
        {checking && <p className="muted tiny">Checking the offer against the chain…</p>}
        {check?.terms && (
          <>
            <div className="preview">
              <p><b>Terms.</b> Rate up to {(check.offer.offer.rateBps / 100).toFixed(2)}% a year, {Math.floor(Number(check.terms.secs) / 86400)} days early.</p>
              <dl className="kv">
                <div><dt>Invoice face value</dt><dd><Money minor={check.invoice.amount} /></dd></div>
                <div><dt>Discount you keep</dt><dd><Money minor={check.terms.discount} accent /></dd></div>
                <div><dt>Supplier receives now</dt><dd><Money minor={check.terms.net} /></dd></div>
                <div><dt>Success fee (on the discount, paid by you)</dt><dd><Money minor={check.terms.fee} /></dd></div>
                <div><dt>You pay in total</dt><dd><Money minor={check.terms.outflow} accent /></dd></div>
              </dl>
              <p className="muted tiny">The contract recomputes the discount at the moment it runs. If a little time passes, the discount can only get smaller, never larger.</p>
            </div>
            {check.problems.map((p) => <Notice key={p} kind="warn" title={p} />)}
            <div className="modal-foot" style={{ padding: 0, border: 0 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              {needsAllowance && check.problems.length === 0 ? (
                <button type="button" className="btn btn-primary" disabled={!!tx.busy} onClick={() => void approve()}>{tx.busy ? `${tx.busy}…` : "Allow Misthos to use your USDC"}</button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={!!tx.busy || check.problems.length > 0} onClick={() => void pay()}>{tx.busy ? `${tx.busy}…` : "Pay early"}</button>
              )}
            </div>
            <p className="muted tiny"><Tag>on-chain</Tag> The payment is one transaction. The supplier is paid in the same moment.</p>
          </>
        )}
      </Modal>
    </>
  );
}

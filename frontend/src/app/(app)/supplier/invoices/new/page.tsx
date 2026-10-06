"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { keccak256, toHex } from "viem";
import { useChainData } from "@/components/app/ChainData";
import { RequireWallet } from "@/components/app/RequireWallet";
import { AddressChip, Field, Money, Notice, PageHeader, Stepper, Card } from "@/components/ui/kit";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/components/wallet/WalletProvider";
import { INVOICE_BOOK_ABI } from "@/lib/chain/abi";
import { appChain, publicClient } from "@/lib/chain/client";
import { CONFIG } from "@/lib/config";
import { MoneyError, domain, invoiceId, invoiceTypedData, toMinor, type InvoiceMsg } from "@/lib/core";
import { dateOnly } from "@/lib/format";
import { randomNonce } from "@/lib/offers";
import { saveInvoiceMeta } from "@/lib/storage";
import { friendlyError, useTx } from "@/lib/tx";

const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => isoDay(new Date(Date.now() + n * 86_400_000));

export default function NewInvoice() {
  return (
    <>
      <PageHeader
        title="New invoice"
        lead="Describe what you are owed and sign it once. No account, no email, and the buyer cannot change it afterwards."
        help={
          <>
            <p><b>What signing does.</b> Your wallet signs the invoice details (amount, buyer, due date). The signature is checked by the contract, so only an invoice you really signed can exist.</p>
            <p><b>Then it is recorded on Arc.</b> That is one small transaction, paid in USDC from your wallet. After that the buyer can approve it.</p>
            <p><b>Reference and note.</b> The reference becomes a fingerprint on chain (a hash). The note stays on this device only; the chain never sees it.</p>
          </>
        }
      />
      <RequireWallet why="Invoices are signed with your wallet, so connect first.">{(me) => <Form me={me} />}</RequireWallet>
    </>
  );
}

function Form({ me }: { me: `0x${string}` }) {
  const w = useWallet();
  const router = useRouter();
  const toast = useToast();
  const chain = useChainData();
  const tx = useTx();

  const [buyer, setBuyer] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(inDays(30));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState<{ inv: InvoiceMsg; sig: `0x${string}`; id: `0x${string}` } | null>(null);

  const errors = useMemo(() => {
    const e: Partial<Record<"buyer" | "amount" | "due" | "reference" | "note", string>> = {};
    if (!isAddress(buyer)) e.buyer = "Enter the buyer's wallet address (starts with 0x, 42 characters).";
    else if (buyer.trim().toLowerCase() === me.toLowerCase()) e.buyer = "The buyer must be a different wallet from yours.";
    try {
      if (toMinor(amount) <= 0n) e.amount = "The amount must be more than zero.";
    } catch (x) {
      e.amount = x instanceof MoneyError ? "Use numbers with up to 6 decimals, for example 2000 or 1250.50." : "Enter the amount in USDC.";
    }
    const dueMs = Date.parse(`${due}T12:00:00Z`);
    if (!due || Number.isNaN(dueMs)) e.due = "Choose a due date.";
    else if (dueMs < Date.now() + 86_400_000) e.due = "The due date must be at least tomorrow.";
    if (reference.length > 120) e.reference = "Keep the reference under 120 characters.";
    if (note.length > 280) e.note = "Keep the note under 280 characters.";
    return e;
  }, [buyer, amount, due, reference, note, me]);
  const valid = Object.keys(errors).length === 0;

  const parsed = valid ? { amount: toMinor(amount), dueSec: Math.floor(Date.parse(`${due}T12:00:00Z`) / 1000) } : null;
  const refHash = keccak256(toHex(reference.trim()));
  const duplicate = valid
    ? chain.invoices.find((i) => i.supplier === me.toLowerCase() && i.buyer === buyer.trim().toLowerCase() && i.amount === parsed!.amount && i.refHash === refHash)
    : undefined;

  const register = async (s: NonNullable<typeof signed>) => {
    const hash = await tx.run({ pending: "Registering invoice", done: "Invoice registered" }, (wc, account) =>
      wc.writeContract({ address: CONFIG.book!, abi: INVOICE_BOOK_ABI, functionName: "registerInvoice", args: [s.inv, s.sig], account, chain: appChain }),
    );
    if (!hash) return;
    saveInvoiceMeta(s.id, { reference: reference.trim(), description: note.trim() });
    await chain.refresh();
    router.push(`/invoices/${s.id}`);
  };

  const submit = async () => {
    setTouched(true);
    if (!valid || !parsed || !CONFIG.book || !w.walletClient) return;
    if (!w.onRightNetwork) return void toast.push({ kind: "error", title: `Switch to ${CONFIG.networkName}`, body: "Your wallet is on a different network." });
    const inv: InvoiceMsg = {
      supplier: me,
      buyer: buyer.trim().toLowerCase() as `0x${string}`,
      token: CONFIG.usdc,
      amount: parsed.amount,
      dueDate: BigInt(parsed.dueSec),
      refHash,
      nonce: randomNonce(),
    };
    const d = domain(CONFIG.chainId, CONFIG.book);
    const td = invoiceTypedData(d, inv);
    setSigning(true);
    try {
      const sig = await w.walletClient.signTypedData({ account: me, ...td });
      // Verify locally before anything is sent (EOA or contract wallet).
      const ok = await publicClient().verifyTypedData({ address: me, ...td, signature: sig }).catch(() => false);
      if (!ok) throw new Error("The signature did not verify against your address.");
      const next = { inv, sig, id: invoiceId(d, inv) };
      setSigned(next);
      toast.push({ kind: "success", title: "Invoice signed", body: "Now recording it on Arc." });
      await register(next);
    } catch (e) {
      toast.push({ kind: "error", title: "Signing did not go through", body: friendlyError(e) });
    } finally {
      setSigning(false);
    }
  };

  const busy = signing || !!tx.busy;
  const step = signed ? (tx.busy ? 1 : 1) : 0;

  return (
    <div className="split">
      <Card title="Invoice details">
        {!CONFIG.book && <Notice kind="warn" title="The contract is not deployed on this network yet">You can fill this in, but signing is disabled until it is.</Notice>}
        <form
          className="form"
          onSubmit={(ev) => {
            ev.preventDefault();
            void submit();
          }}
          noValidate
        >
          <Field label="Buyer wallet" htmlFor="buyer" error={touched ? errors.buyer : undefined} hint="The business that owes you. They will see this invoice when they connect with this address.">
            <input id="buyer" className="input mono" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Amount (USDC)" htmlFor="amount" error={touched ? errors.amount : undefined} hint="The full amount you are owed. USDC has 6 decimals.">
            <input id="amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000.00" autoComplete="off" />
          </Field>
          <Field label="Due date" htmlFor="due" error={touched ? errors.due : undefined} hint="When the buyer would normally pay. Early payment is priced against the days before this date.">
            <input id="due" type="date" className="input" min={inDays(1)} value={due} onChange={(e) => setDue(e.target.value)} />
            <div className="quick" role="group" aria-label="Quick due dates">
              {[15, 30, 45, 60].map((n) => (
                <button key={n} type="button" className="pill-btn" aria-pressed={due === inDays(n)} onClick={() => setDue(inDays(n))}>
                  In {n} days
                </button>
              ))}
            </div>
          </Field>
          <Field label="Reference" htmlFor="ref" error={touched ? errors.reference : undefined} hint="Your PO or contract number. Stored on chain as a fingerprint only.">
            <input id="ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO-2043" autoComplete="off" />
          </Field>
          <Field label="Private note" htmlFor="note" error={touched ? errors.note : undefined} hint="Optional, up to 280 characters. Stays on this device and is never sent to an agent.">
            <textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>

          {valid && parsed && (
            <div className="preview" aria-live="polite">
              <p><b>You are signing:</b> <Money minor={parsed.amount} accent /> due {dateOnly(parsed.dueSec)}</p>
              <p className="muted tiny">from <AddressChip address={me} you /> to <AddressChip address={buyer.trim()} /></p>
            </div>
          )}
          {duplicate && (
            <Notice kind="warn" title="This looks like an invoice you already created">
              Same buyer, amount and reference. Registering it twice is blocked by the contract only if the signature is identical, so check first.
            </Notice>
          )}

          <div className="actions-row">
            {signed && !tx.busy && !chain.invoices.some((i) => i.id === signed.id) ? (
              <button type="button" className="btn btn-primary" onClick={() => void register(signed)} disabled={busy}>Register on Arc</button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={busy || !CONFIG.book}>
                {signing ? "Waiting for your signature…" : tx.busy ? `${tx.busy}…` : "Sign invoice"}
              </button>
            )}
            {touched && !valid && <span className="field-error">Fix the highlighted fields first.</span>}
          </div>
        </form>
      </Card>

      <div style={{ display: "grid", gap: 16 }}>
        <Card title="What happens next">
          <Stepper steps={["Sign", "Register on Arc", "Buyer approves", "Offer early payment", "Paid"]} current={step} />
          <p className="muted">After you register, open the invoice to follow it. Once the buyer approves, you can offer to be paid early.</p>
        </Card>
        <Card title="Good to know">
          <p className="muted">Recording the invoice costs a small network fee in USDC. A relayer that pays it for you is planned; until then your wallet pays.</p>
          <p className="muted">Nothing here moves money. Money moves only when the buyer pays, and never more than the price you sign.</p>
        </Card>
      </div>
    </div>
  );
}

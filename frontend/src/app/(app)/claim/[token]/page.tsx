"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, Notice, PageHeader, Stepper } from "@/components/ui/kit";
import { useWallet } from "@/components/wallet/WalletProvider";

/**
 * Claim links are bearer secrets that let a supplier who has not joined be paid early (CLAUDE.md 8.15 and P15). Checking one
 * needs the Misthos server, which stores only a hash of each token. That server is not built, so this page says so plainly and
 * never shows terms it cannot verify.
 */
export default function Claim() {
  const { token } = useParams<{ token: string }>();
  const w = useWallet();
  return (
    <>
      <PageHeader
        title="Claim early payment"
        lead="A buyer sent you this link so you can be paid before the due date, without creating an account first."
        help={
          <>
            <p><b>How claim links will work.</b> A buyer approves your invoice and creates a link with a pre-agreed rate, often 0%. You open it, see the exact amount you get now against what you would wait for, create a wallet with your email, sign, and are paid.</p>
            <p><b>Why it is safe.</b> The link works once, expires, and the page shows the address that will be paid before you sign. The buyer&apos;s limits still apply.</p>
          </>
        }
      />
      <Notice kind="warn" title="This link cannot be checked yet">
        Claim links are verified by the Misthos server, which is not live. Until it is, this page cannot confirm the link <span className="mono">{token?.slice(0, 6)}…</span>, so it shows no amounts rather than guessing.
      </Notice>

      <Card title="What you can do now">
        <p className="muted">If the buyer already approved your invoice, you can be paid early today with a wallet:</p>
        <Stepper steps={["Connect a wallet", "Find your invoice", "Sign an offer", "Send it to the buyer", "Paid"]} current={w.status === "connected" ? 1 : 0} />
        <div className="actions-row">
          {w.status !== "connected" && <button type="button" className="btn btn-primary" onClick={w.openModal}>Connect wallet</button>}
          <Link className="btn btn-ghost" href="/supplier">My invoices</Link>
          <Link className="btn btn-ghost" href="/">What is Misthos?</Link>
        </div>
      </Card>

      <Card title="Keep your link private">
        <p className="muted">Treat a claim link like cash: anyone who has it could try to use it. Do not forward it. The page will show the payout address before you sign anything, so check it is yours.</p>
      </Card>
    </>
  );
}

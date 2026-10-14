"use client";

import { useState, type ReactNode } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { Notice, Skeleton } from "@/components/ui/kit";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Crystals, WalletCards } from "./Gate";
import { RoleChoice } from "./RoleChoice";

const STEPS = ["Sign in with your wallet", "Choose your side"];

function Frame({ step, title, lead, children }: { step: 1 | 2; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section className="gate" aria-labelledby="onb-title">
      <Crystals />
      <div className="gate-inner">
        <p className="eyebrow">{`Step ${step} of 2`}</p>
        <h1 id="onb-title" className="gate-title">
          {title}
        </h1>
        <p className="lead gate-lead">{lead}</p>
        {children}
        <ol className="gate-steps" aria-label="Setup steps">
          {STEPS.map((t, i) => (
            <li key={t} data-current={i + 1 === step} data-done={i + 1 < step}>
              <span className="step-dot">{i + 1 < step ? "✓" : i + 1}</span>
              <div>
                <b>{t}</b>
              </div>
            </li>
          ))}
        </ol>
        <p className="muted tiny">Public pages (stats, invoices, ledger, agents) stay open to everyone without signing in.</p>
      </div>
    </section>
  );
}

/**
 * The front door when the app has a server: your wallet signs a one-time message (no email, no third party, no transaction),
 * and you choose a side. Used by /app and by any supplier or buyer page opened before it is finished.
 */
export function Onboarding() {
  const acct = useAccount();
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (acct.status === "loading") return <Skeleton rows={4} />;
  if (acct.status === "unreachable") {
    return (
      <section className="gate gate-inline">
        <div className="gate-inner">
          <Notice kind="error" title="The Misthos server is not reachable">
            {acct.error} Public pages still work. Try again in a moment.
          </Notice>
        </div>
      </section>
    );
  }

  const me = acct.me;
  if (!me) {
    const connected = w.status === "connected" && !!w.address;
    return (
      <Frame
        step={1}
        title="Sign in with your wallet"
        lead="Your wallet is your account. You sign a message that sends no transaction and costs nothing. We store your address and nothing else: no email, no password."
      >
        <div className="onb-action">
          {!connected ? (
            <WalletCards />
          ) : (
            <>
              {!w.onRightNetwork && (
                <Notice kind="warn" title="Wrong network" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => void w.switchNetwork()}>Switch</button>}>
                  Switch your wallet to the network this site uses first.
                </Notice>
              )}
              <p className="muted">
                Connected wallet: <span className="mono">{w.address}</span>
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(await acct.signIn());
                  setBusy(false);
                }}
              >
                {busy ? "Check your wallet…" : "Sign in"}
              </button>
            </>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      </Frame>
    );
  }

  // Step 2: the side. RoleChoice shows the two cards and moves on once the server accepts.
  return <RoleChoice address={me.address!} onChoose={(s) => acct.chooseSide(s)} />;
}

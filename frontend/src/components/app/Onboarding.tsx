"use client";

import { useState, type ReactNode } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { GoogleButton } from "@/components/account/GoogleButton";
import { Notice, Skeleton } from "@/components/ui/kit";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Crystals, WalletCards } from "./Gate";
import { RoleChoice } from "./RoleChoice";

const STEPS = ["Sign in with Google", "Link your wallet", "Choose your side"];

function Frame({ step, title, lead, children }: { step: 1 | 2 | 3; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section className="gate" aria-labelledby="onb-title">
      <Crystals />
      <div className="gate-inner">
        <p className="eyebrow">{`Step ${step} of 3`}</p>
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
 * The three-step front door when the app has a server: Google proves who you are, your wallet proves which money is yours,
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
    return (
      <Frame step={1} title="Sign in to get started" lead="Google tells us who you are. Your wallet signs the money. Each account is one Google identity, one wallet and one side.">
        <div className="onb-action">
          <GoogleButton
            onCredential={async (c) => {
              setError(await acct.signIn(c));
            }}
          />
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      </Frame>
    );
  }

  if (me.step === "wallet") {
    const connected = w.status === "connected" && !!w.address;
    return (
      <Frame
        step={2}
        title="Link your wallet"
        lead={
          <>
            Signed in as <b>{me.email}</b>. Link the wallet you will sign invoices and payments with. You sign a message: it sends no transaction and costs nothing.
          </>
        }
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
                  setError(await acct.linkWallet());
                  setBusy(false);
                }}
              >
                {busy ? "Check your wallet…" : "Link this wallet"}
              </button>
            </>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void acct.signOut()}>
            Use a different Google account
          </button>
        </div>
      </Frame>
    );
  }

  // Step 3: the side. RoleChoice shows the two cards and moves on once the server accepts.
  return <RoleChoice address={me.address!} onChoose={(s) => acct.chooseSide(s)} />;
}

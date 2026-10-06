"use client";

import type { ReactNode } from "react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CONFIG } from "@/lib/config";

const INSTALL = [
  { name: "MetaMask", href: "https://metamask.io/download/" },
  { name: "Rabby", href: "https://rabby.io/" },
  { name: "Coinbase Wallet", href: "https://www.coinbase.com/wallet/downloads" },
];

/** Floating glass crystals behind the gate. Pure CSS (no WebGL), coloured by the active theme. */
export function Crystals() {
  return (
    <div className="crystals" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} style={{ ["--i" as string]: i }} />
      ))}
    </div>
  );
}

/** The wallet choices as cards: the browser wallets that are installed, or where to get one. */
export function WalletCards() {
  const w = useWallet();
  return (
    <div className="wallet-cards">
      {w.error && <p className="field-error">{w.error}</p>}
      {w.wallets.length > 0 ? (
        <ul>
          {w.wallets.map((x) => (
            <li key={x.id}>
              <button type="button" className="wallet-card" onClick={() => void w.connect(x)} disabled={w.status === "connecting"}>
                {x.icon ? <img src={x.icon} alt="" width={36} height={36} /> : <span className="wallet-glyph" aria-hidden="true" />}
                <span>
                  <b>{x.name}</b>
                  <small>{w.status === "connecting" ? "Check your wallet…" : "Detected in this browser"}</small>
                </span>
                <span className="wallet-card-go" aria-hidden="true">→</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="muted">No browser wallet found. Install one, then reload this page.</p>
          <ul>
            {INSTALL.map((x) => (
              <li key={x.name}>
                <a className="wallet-card" href={x.href} target="_blank" rel="noreferrer">
                  <span className="wallet-glyph" aria-hidden="true" />
                  <span>
                    <b>{x.name}</b>
                    <small>Install</small>
                  </span>
                  <span className="wallet-card-go" aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const STEPS = [
  ["1", "Connect", "Your own browser wallet. Misthos never holds your keys."],
  ["2", "Choose your side", "Supplier if you are owed money, buyer if you owe it. Switch any time."],
  ["3", "Get on with it", "Sign an invoice, or approve and pay one, with every price shown first."],
];

/** The front door shown before a wallet is connected: one headline, the wallets, and what happens next. */
export function WalletGate() {
  return (
    <section className="gate" aria-labelledby="gate-title">
      <Crystals />
      <div className="gate-inner">
        <p className="eyebrow">{`{${CONFIG.networkName}}`}</p>
        <h1 id="gate-title" className="gate-title">
          Get paid days after approval.
          <span> Pay early, only when it is worth it.</span>
        </h1>
        <p className="lead gate-lead">
          Connect a wallet to start. Two agents agree the price of paying sooner, starting at 0%, and a contract on Arc settles it in under a second.
        </p>
        <WalletCards />
        <ol className="gate-steps">
          {STEPS.map(([n, t, d]) => (
            <li key={n}>
              <span className="step-dot">{n}</span>
              <div>
                <b>{t}</b>
                <p className="muted">{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="muted tiny">You can read every public page without a wallet: the stats, invoices and agents are open.</p>
      </div>
    </section>
  );
}

/** Used inside a page that acts for a person: a smaller version of the gate, with the reason this page needs a wallet. */
export function InlineGate({ why }: { why: ReactNode }) {
  return (
    <section className="gate gate-inline" aria-label="Connect your wallet">
      <Crystals />
      <div className="gate-inner">
        <h2 className="gate-sub">Connect your wallet to continue</h2>
        <p className="lead gate-lead">{why}</p>
        <WalletCards />
      </div>
    </section>
  );
}

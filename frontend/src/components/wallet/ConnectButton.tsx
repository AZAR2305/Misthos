"use client";

import { useEffect, useRef, useState } from "react";
import { CONFIG, addressUrl } from "@/lib/config";
import { Modal } from "@/components/ui/kit";
import { useWallet } from "./WalletProvider";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The one Connect wallet control. Shows the account and network once connected, and a menu to switch or disconnect. */
export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", on);
    return () => window.removeEventListener("mousedown", on);
  }, [open]);

  if (w.status !== "connected" || !w.address) {
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={w.openModal} disabled={w.status === "connecting"}>
        {w.status === "connecting" ? "Connecting…" : compact ? "Connect" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div className="wallet-menu" ref={box}>
      <button type="button" className="wallet-pill" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="dot" data-ok={w.onRightNetwork} aria-hidden="true" />
        <span className="mono">{short(w.address)}</span>
        {!compact && <span className="wallet-net">{w.onRightNetwork ? CONFIG.networkName : "Wrong network"}</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          <p className="menu-head">
            {w.walletName} · <span className="mono">{short(w.address)}</span>
          </p>
          {!w.onRightNetwork && (
            <button type="button" role="menuitem" onClick={() => void w.switchNetwork()}>
              Switch to {CONFIG.networkName}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => void navigator.clipboard?.writeText(w.address!)}>
            Copy address
          </button>
          <a role="menuitem" href={addressUrl(w.address)} target="_blank" rel="noreferrer">
            View on explorer
          </a>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); w.disconnect(); }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** Pick a wallet. Browser wallets work today; Circle Agent Wallets are for the agents, not for people clicking. */
export function ConnectModal() {
  const w = useWallet();
  return (
    <Modal open={w.modalOpen} onClose={w.closeModal} title="Connect a wallet">
      <p className="muted">
        Connect the wallet you sign invoices and payments with. Misthos never holds your keys. Everything you sign is shown first and
        sent to {CONFIG.networkName}.
      </p>
      {w.error && <p className="field-error">{w.error}</p>}
      {w.wallets.length > 0 ? (
        <ul className="wallet-list">
          {w.wallets.map((x) => (
            <li key={x.id}>
              <button type="button" className="wallet-option" onClick={() => void w.connect(x)}>
                {x.icon ? <img src={x.icon} alt="" width={28} height={28} /> : <span className="wallet-glyph" aria-hidden="true" />}
                <span>{x.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="notice" data-kind="warn">
          <div>
            <p className="notice-title">No browser wallet found</p>
            <div className="notice-body">
              Install one, such as <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> or{" "}
              <a href="https://rabby.io/" target="_blank" rel="noreferrer">Rabby</a>, then reload this page.
            </div>
          </div>
        </div>
      )}
      <div className="modal-aside">
        <p className="muted">
          <strong>Running an agent?</strong> Agents sign with a Circle Agent Wallet through the Circle CLI, not a browser extension. See{" "}
          <a href="/agents">the agents page</a>.
        </p>
        <p className="muted">
          <strong>Not a crypto user?</strong> Managed wallets (sign in with email) are planned. Suppliers will also be able to claim
          early payment from a link. Neither is live yet.
        </p>
      </div>
    </Modal>
  );
}

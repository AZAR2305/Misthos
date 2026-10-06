"use client";

import { AddressChip, Money } from "@/components/ui/kit";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CONFIG } from "@/lib/config";
import { useUsdcBalance } from "@/lib/hooks";

/**
 * The connected wallet and the USDC it holds, front and centre. The figure is read from the chain every few seconds and
 * is never estimated; if it cannot be read, the card says so.
 */
export function WalletCard() {
  const w = useWallet();
  const { balance, error, reload } = useUsdcBalance(w.address);
  if (w.status !== "connected" || !w.address) return null;
  return (
    <section className="card wallet-card-hero" aria-label="Your wallet and USDC balance">
      <div className="wch-id">
        <p className="ptag">Your wallet</p>
        <AddressChip address={w.address} you />
        <p className="muted tiny">
          <span className="dot" data-ok={w.onRightNetwork} aria-hidden="true" /> {w.walletName ?? "Browser wallet"} · {w.onRightNetwork ? CONFIG.networkName : "wrong network"}
        </p>
      </div>
      <div className="wch-balance">
        <p className="muted tiny">USDC held by this wallet</p>
        <p className="wch-amount" aria-live="polite">
          {balance !== null ? <Money minor={balance} count /> : error ? <span className="muted">Unavailable</span> : <span className="muted">Reading…</span>}
          <span className="wch-unit">USDC</span>
        </p>
        <p className="muted tiny">
          {error && balance === null ? (
            <>
              The balance could not be read. <button type="button" className="linklike" onClick={() => void reload()}>Try again</button>
            </>
          ) : balance === 0n ? (
            <>
              Nothing yet. <a className="linklike" href={CONFIG.faucetUrl} target="_blank" rel="noreferrer">Get free test USDC</a>
            </>
          ) : (
            "Read from the chain, refreshed every few seconds."
          )}
        </p>
      </div>
    </section>
  );
}

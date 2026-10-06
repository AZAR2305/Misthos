"use client";

import { useEffect, useState } from "react";
import { getLatestSettlement, type LatestSettlement } from "@/lib/settlement";

/** Miniature discount curve. With no settlement it draws the empty arc as a dashed path (an honest empty state). */
function MiniCurve({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 120 56" width="120" height="56" aria-hidden="true" fill="none">
      <path
        d="M6 50 C 30 50, 38 8, 60 8 S 90 50, 114 50"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={filled ? undefined : "3 6"}
        opacity={filled ? 1 : 0.7}
      />
    </svg>
  );
}

function LatestPanel() {
  const [s, setS] = useState<LatestSettlement | null>(null);
  useEffect(() => {
    let live = true;
    getLatestSettlement().then((r) => live && setS(r));
    return () => {
      live = false;
    };
  }, []);

  let body: React.ReactNode = <span className="muted">Loading the latest settlement</span>;
  if (s?.status === "unavailable") body = <>Unavailable: {s.reason}</>;
  if (s?.status === "empty") body = <>No settlement yet. Create the first invoice.</>;
  if (s?.status === "ready") body = <>{s.invoiceRef} paid {s.daysEarly} days early</>;

  return (
    <div className="hero-latest" aria-live="polite">
      <MiniCurve filled={s?.status === "ready"} />
      <div>
        <p className="tag">{"{on-chain}"} latest settlement</p>
        <p className="hero-latest-body">{body}</p>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="hero">
      <div className="hero-copy">
        <h1 className="display">
          Get paid days after approval, not weeks
        </h1>
        <p className="lede">
          Your invoice is approved. Why wait a month? Two agents agree the price of waiting, and Arc settles it in USDC in
          under a second.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="/app">
            Open app
          </a>
          <a className="btn btn-ghost" href="#steps">
            See how it works
          </a>
        </div>
      </div>
      <div className="hero-foot">
        <p className="mono hero-scroll">//scroll</p>
        <LatestPanel />
        <p className="tag hero-net">{"{testnet}"} Arc · chain 5042002</p>
      </div>
    </section>
  );
}

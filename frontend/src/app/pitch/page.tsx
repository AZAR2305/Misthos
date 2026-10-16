"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./pitch.css";

/**
 * The pitch, as web slides. Left/right arrows, Space and PageUp/PageDown move; Home and End jump; F is fullscreen; /pitch#3 opens slide 3.
 * Every number here is a real one from docs/TRACTION.md, docs/DECISIONS.md or docs/MARKET_RESEARCH.md. The traction slide shows zero
 * independent pilots because there are none yet: it is updated from docs/TRACTION.md when a pilot is confirmed, never before.
 */

const EXPLORER = "https://explorer.testnet.arc.io/tx/";
const TX_25 = "0x8d581c6a48fcb14892ea647405a9370d274d80dfb9e9f7459241da1bee3ec8a1";
const TX_40 = "0x7f0e67359180504dd7b00455fc85c542d43b7389536bfdb456c313f9df0c8119";

function Intro() {
  return (
    <>
      <div className="pd-eyebrow">Tameion Agents Hackathon · Canteen × Circle × Arc</div>
      <h1 className="pd-hero">Misthos</h1>
      <p className="pd-lede">Two businesses, two agents, one signed price for getting paid early. Often 0%. Settled on Arc in under a second.</p>
    </>
  );
}

function Problem() {
  const items = [
    { big: "~45 days", k: "average B2B payment terms", src: "Atradius 2025, via Kaplan (secondhand)" },
    { big: "26–30%", k: "a year: what factoring costs a small supplier", src: "Fundthrough, Resolve Pay, eCapital (sellers' own figures)" },
    { big: "~3.9%", k: "what a buyer's idle cash could earn in T-bills", src: "3-month US Treasury, Aug 2026" },
  ];
  return (
    <>
      <h2 className="pd-h2">Suppliers wait a month. The buyer&apos;s cash sits idle.</h2>
      <div className="pd-grid">
        {items.map((s) => (
          <div key={s.big} className="pd-card">
            <div className="pd-big pd-money">{s.big}</div>
            <p>{s.k}</p>
            <div className="pd-src">{s.src}</div>
          </div>
        ))}
      </div>
      <p className="pd-lede">Both sides lose, and today&apos;s tools price the gap at factoring rates or fixed discounts.</p>
    </>
  );
}

function Solution() {
  const items = [
    { t: "Supplier agent", d: "Starts at 0% and climbs a short ladder of signed early-pay offers, never past its own ceiling.", agent: true },
    { t: "Buyer agent", d: "Allocates idle USDC across approved invoices, paying early only when it beats its private hurdle rate.", agent: true },
    { t: "InvoiceBook contract", d: "Enforces the signed terms and settles on Arc in under a second. The cleared price is often 0%." },
  ];
  return (
    <>
      <h2 className="pd-h2">Let each business&apos;s agent find the price.</h2>
      <div className="pd-grid">
        {items.map((s) => (
          <div key={s.t} className={`pd-card ${s.agent ? "pd-agent" : ""}`}>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
          </div>
        ))}
      </div>
      <p className="pd-lede">The model proposes, code decides: no model output ever reaches a signer or a contract call.</p>
    </>
  );
}

function How() {
  const steps = [
    ["1", "Register", "Supplier registers the invoice. The server pays gas; the contract checks the supplier's signature."],
    ["2", "Approve", "The buyer approves it on-chain."],
    ["3", "Negotiate", "Two separate agent processes trade signed offers over HTTP. No shared memory."],
    ["4", "Settle", "The buyer agent pays from its Circle Agent Wallet. USDC moves, the contract records the rate and days early."],
  ];
  return (
    <>
      <h2 className="pd-h2">How a payment clears.</h2>
      <div className="pd-grid">
        {steps.map(([n, t, d]) => (
          <div key={n} className="pd-card">
            <span className="pd-tag">{n}</span>
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function Proof() {
  return (
    <>
      <h2 className="pd-h2">It runs on Arc testnet today.</h2>
      <div className="pd-grid">
        <div className="pd-card">
          <div className="pd-big pd-money">2</div>
          <p>real settlements with Circle Agent Wallets on Arc testnet (25 and 40 USDC, 14 Oct 2026). Run by the build team, so labelled as team runs.</p>
          <a href={EXPLORER + TX_25}>25 USDC settlement ↗</a>
          <a href={EXPLORER + TX_40}>40 USDC settlement, cleared at 0% ↗</a>
        </div>
        <div className="pd-card">
          <div className="pd-big pd-money">29 and 44</div>
          <p>days early. One of the two cleared at 0%.</p>
        </div>
        <div className="pd-card">
          <div className="pd-big">59 / 236 / 91 / 56</div>
          <p>passing tests: contract (with fuzz and invariants), agent, backend, frontend. The fail-closed matrix passed 4 of 4.</p>
        </div>
        <div className="pd-card pd-agent">
          <h3>Reputation on chain</h3>
          <p>ERC-8004 identities and bilateral feedback for both agents, visible on the explorer. The buyer reads a supplier&apos;s feedback live before it pays.</p>
        </div>
      </div>
    </>
  );
}

function Traction() {
  return (
    <>
      <h2 className="pd-h2">Traction, counted honestly.</h2>
      <div className="pd-grid">
        <div className="pd-card">
          <div className="pd-big">0</div>
          <p>independent businesses onboarded so far</p>
        </div>
        <div className="pd-card">
          <div className="pd-big pd-money">2</div>
          <p>team runs, shown separately and never added to pilots: 65 USDC face, 1 of 2 cleared at 0%</p>
        </div>
        <div className="pd-card">
          <h3>Ready for the first pilot</h3>
          <p>Pilot guide, 10-minute call script, origin tagging (pilot, team, unverified, never summed) and a no-wallet shadow report at /shadow.</p>
        </div>
      </div>
      <p className="pd-note">Test USDC counts. Synthetic data does not, so none is shown. The live stats page reads the chain in your browser and lists each origin separately.</p>
    </>
  );
}

function Different() {
  const Y = "✓";
  const N = "—";
  const rows: string[][] = [
    ["Dynamic-discount platforms", N, N, N, "fixed or platform-set"],
    ["Invoice factoring", N, N, N, "26–30% a year"],
    ["Misthos", Y, Y, Y, "negotiated, often 0%"],
  ];
  return (
    <>
      <h2 className="pd-h2">Why Misthos is different.</h2>
      <table className="pd-table">
        <thead>
          <tr>
            <th />
            <th>Agent on each side</th>
            <th>Signed terms enforced on-chain</th>
            <th>Sub-second settlement</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className={r[0] === "Misthos" ? "us" : ""}>
              {r.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pd-src">Competitor cells describe the product category, not a measured comparison. VERIFY before naming any company.</p>
    </>
  );
}

function Next() {
  return (
    <>
      <h2 className="pd-h2">What happens after the hackathon.</h2>
      <div className="pd-grid">
        <div className="pd-card">
          <h3>Now</h3>
          <p>First independent pilots. Host the backend so accounts, credit limits and claim links work on the live site.</p>
        </div>
        <div className="pd-card">
          <h3>Next</h3>
          <p>Managed wallets so a business needs no crypto wallet to claim. A keyed RPC and a read index for load.</p>
        </div>
        <div className="pd-card">
          <h3>Open kit</h3>
          <p>The agents, protocol and contract are open source, built to keep going as a product for small businesses.</p>
        </div>
      </div>
      <p className="pd-lede">Try it: misthos-kit.vercel.app</p>
    </>
  );
}

const SLIDES: { title: string; render: () => ReactNode }[] = [
  { title: "Misthos", render: () => <Intro /> },
  { title: "The problem", render: () => <Problem /> },
  { title: "The solution", render: () => <Solution /> },
  { title: "How it works", render: () => <How /> },
  { title: "What runs today", render: () => <Proof /> },
  { title: "Traction", render: () => <Traction /> },
  { title: "Why it's different", render: () => <Different /> },
  { title: "What's next", render: () => <Next /> },
];

export default function PitchPage() {
  const [i, setI] = useState(0);
  const deck = useRef<HTMLDivElement>(null);
  const total = SLIDES.length;

  const go = useCallback(
    (n: number) => {
      const next = Math.max(0, Math.min(total - 1, n));
      setI(next);
      window.history.replaceState(null, "", `#${next + 1}`);
    },
    [total],
  );

  useEffect(() => {
    const n = Number(window.location.hash.slice(1));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (n >= 1 && n <= total) setI(n - 1);
  }, [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(i + 1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        go(i - 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(total - 1);
      else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void deck.current?.requestFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go, total]);

  return (
    <div ref={deck} className="pd">
      <section key={i} className="pd-slide" aria-label={SLIDES[i].title}>
        {i > 0 && (
          <div className="pd-eyebrow">
            {String(i + 1).padStart(2, "0")} / {String(total).padStart(2, "0")} · {SLIDES[i].title}
          </div>
        )}
        {SLIDES[i].render()}
      </section>
      <div className="pd-controls">
        <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">←</button>
        <div className="pd-dots">
          {SLIDES.map((s, n) => (
            <button key={s.title} onClick={() => go(n)} className={n === i ? "on" : ""} aria-label={`Slide ${n + 1}: ${s.title}`} />
          ))}
        </div>
        <button onClick={() => go(i + 1)} disabled={i === total - 1} aria-label="Next slide">→</button>
        <span className="pd-hint">← → to move · F for fullscreen</span>
      </div>
    </div>
  );
}

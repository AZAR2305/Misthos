"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./pitch.css";

/**
 * The pitch, as web slides. Left/right arrows, Space and PageUp/PageDown move; Home and End jump; F is fullscreen; /pitch#3 opens slide 3.
 * Every number here is a real one from docs/MARKET_RESEARCH.md. Traction and run results are on /stats, which reads the chain.
 */

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

function Different() {
  // Cells for other companies paraphrase their own public descriptions (sources under the table). VERIFY before naming a company on stage.
  const cols = ["Who sets the price", "Agent on each side", "Terms enforced by a contract", "Funded by", "Settlement", "Can clear at 0%"];
  const rows: string[][] = [
    ["Misthos", "Two agents negotiate: supplier climbs a ladder from 0%, buyer holds a private hurdle", "Yes, both sides", "Yes: InvoiceBook checks the signed offer", "The buyer's own idle USDC, no lender", "On Arc, under a second", "Yes, and one of our two runs did"],
    ["C2FO", "Suppliers bid; an algorithm picks offers that meet the buyer's target", "No", "No (platform)", "Buyer cash, or a funder for supplier finance", "Platform payment run", "Not a design goal"],
    ["Taulia", "Supplier picks the payment date; a program rate applies", "No", "No (platform)", "Buyer cash or third-party funders", "Platform payment run", "Not a design goal"],
    ["Centrifuge", "Pool terms set by originators and investors", "No", "Yes: on-chain pools", "Investors in a pool", "On-chain, pool rules", "Not a design goal"],
    ["Invoice factoring", "The factor", "No", "No", "The factor", "Days", "No: about 26 to 30% a year"],
  ];
  return (
    <>
      <h2 className="pd-h2">Why Misthos is different.</h2>
      <div style={{ overflowX: "auto" }}>
        <table className="pd-table">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
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
      </div>
      <p className="pd-src">
        Other companies are described from their own public pages: c2fo.com dynamic discounting, taulia.com and a regulator filing on its daily rate, Centrifuge and Chainlink&apos;s on-chain factoring overview, and Fundthrough and Resolve Pay on factoring costs.
        This is a summary of what each says it does, not a test of those products. VERIFY before naming a company on stage.
      </p>
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

"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState, Role } from "./AgentStage";
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

const HeroCanvas = dynamic(() => import("./HeroCanvas"), { ssr: false });

/** What the agent says on the tour. Plain claims from the spec: no numbers, nothing that is not true of the kit. */
const LINES: Array<{ text: string; role: Role; pose: AgentState["pose"]; face: AgentState["face"] }> = [
  { text: "Hi, I am the Misthos agent. Basically, I run the clock on your invoices.", role: "supplier", pose: "Wave", face: "neutral" },
  { text: "If you are owed money, I start at 0% and climb a short ladder of early-pay offers, one rung at a time.", role: "supplier", pose: "ThumbsUp", face: "neutral" },
  { text: "If you owe money, I put idle USDC to work, and only when the discount beats your own hurdle rate.", role: "buyer", pose: "Yes", face: "neutral" },
  { text: "Every offer is signed. The contract checks it and settles on Arc in under a second. Often the price is 0%.", role: "buyer", pose: "Jump", face: "surprised" },
  { text: "Ready? Connect a wallet and pick a side.", role: "supplier", pose: "Wave", face: "neutral" },
];

function useTyped(text: string, on: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return setN(text.length);
    setN(0);
    const t = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(t), v) : v + 1)), 22);
    return () => clearInterval(t);
  }, [text, on]);
  return text.slice(0, n);
}

/** The agent greets you, then walks you through the idea in five lines. Click to start; nothing plays by itself before that. */
function AgentGuide() {
  const [step, setStep] = useState(-1); // -1: waiting for the first click
  const [pose, setPose] = useState<AgentState>({ pose: "Idle", poseKey: 0, face: "neutral", bubble: null });
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [gl, setGl] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try {
      const c = document.createElement("canvas");
      setGl(!!(c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      setGl(false);
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    if (wrap.current) io.observe(wrap.current);
    return () => io.disconnect();
  }, []);

  const go = useCallback((n: number) => {
    const next = Math.max(0, Math.min(LINES.length - 1, n));
    setStep(next);
    setPose((p) => ({ pose: LINES[next].pose, poseKey: p.poseKey + 1, face: LINES[next].face, bubble: null }));
  }, []);

  // Advance by itself after the first click, unless the visitor asked for less motion.
  useEffect(() => {
    if (step < 0 || step >= LINES.length - 1 || reduced) return;
    const t = setTimeout(() => go(step + 1), 5200);
    return () => clearTimeout(t);
  }, [step, reduced, go]);

  const line = step >= 0 ? LINES[step] : null;
  const typed = useTyped(line?.text ?? "", !reduced);
  const role = line?.role ?? "supplier";
  const last = step === LINES.length - 1;

  return (
    <div className="hero-guide" ref={wrap}>
      {gl && (
        <div className="hero-agent" aria-hidden="true">
          <HeroCanvas role={role} state={pose} visible={visible} onSelect={() => (step < 0 ? go(0) : go(step + 1 >= LINES.length ? 0 : step + 1))} />
        </div>
      )}
      <div className="hero-say" aria-live="polite">
        {line ? (
          <>
            <p className="tag hero-say-tag">
              {"{agent}"} {step + 1} / {LINES.length}
            </p>
            <p className="hero-say-line">{typed}</p>
            <div className="hero-say-actions">
              {last ? (
                <>
                  <a className="btn btn-primary" href="/app">
                    Connect and choose a side
                  </a>
                  <button type="button" className="btn btn-quiet" onClick={() => go(0)}>
                    Hear it again
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(step + 1)}>
                    Next
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => go(LINES.length - 1)}>
                    Skip
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <p className="hero-say-line hero-say-idle">I am the Misthos agent. Say hello and I will explain.</p>
        )}
      </div>
      {step < 0 && (
        <button type="button" className="hero-start" onClick={() => go(0)}>
          <span className="hero-start-dot" aria-hidden="true" />
          [Click] to start
        </button>
      )}
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="hero">
      <div className="hero-copy">
        <h1 className="display">Get paid days after approval, not weeks</h1>
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
      <AgentGuide />
      <div className="hero-foot">
        <p className="mono hero-scroll">//scroll</p>
        <LatestPanel />
        <p className="tag hero-net">{"{testnet}"} Arc · chain 5042002</p>
      </div>
    </section>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState, Face, Message, Pose, Role } from "./AgentStage";

const AgentStage = dynamic(() => import("./AgentStage"), { ssr: false });

const REST: AgentState = { pose: "Idle", poseKey: 0, face: "neutral", bubble: null };

const ROLES: Record<Role, { name: string; tag: string; lines: string[] }> = {
  supplier: {
    name: "Supplier agent",
    tag: "Holds its cost of waiting privately",
    lines: [
      "Decides whether to accelerate an invoice, where to start its ask and when to stop.",
      "Starts at 0% and climbs a short ladder of signed offers.",
      "Never goes above the cap set by its cost of waiting.",
    ],
  },
  buyer: {
    name: "Buyer agent",
    tag: "Holds its hurdle privately",
    lines: [
      "Chooses which approved invoices to pay early with the cash it can spare.",
      "Accepts the first rung at or above its hurdle, or rejects with a reason code.",
      "Never reveals the hurdle, to the supplier or to anyone before settlement.",
    ],
  },
};

export function Agents() {
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<Role>("supplier");
  const [hover, setHover] = useState<Role | null>(null);
  const [supplier, setSupplier] = useState<AgentState>(REST);
  const [buyer, setBuyer] = useState<AgentState>(REST);
  const [message, setMessage] = useState<Message | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const [settled, setSettled] = useState(false);
  const timers = useRef<number[]>([]);
  const counter = useRef(1);
  const lastWave = useRef(0);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const loadIo = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "900px 0px" });
    const viewIo = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "120px 0px" });
    loadIo.observe(el);
    viewIo.observe(el);
    return () => {
      loadIo.disconnect();
      viewIo.disconnect();
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const act = useCallback(
    (who: Role, pose: Pose, face: Face, bubble: string | null) => {
      const set = who === "supplier" ? setSupplier : setBuyer;
      set((s) => ({ pose, poseKey: s.poseKey + 1 + counter.current++, face, bubble }));
    },
    [],
  );

  const send = (from: Role) => setMessage({ from, key: counter.current++ });

  const offer = () => {
    clearAll();
    setSettled(false);
    act("supplier", "Wave", "neutral", "//r1 offer signed");
    act("buyer", "Idle", "neutral", null);
    send("supplier");
    later(3200, () => setSupplier((s) => ({ ...s, bubble: null })));
  };

  const reject = () => {
    clearAll();
    setSettled(false);
    act("buyer", "No", "angry", "BELOW_HURDLE");
    send("buyer");
    later(900, () => act("supplier", "Idle", "sad", "//r2 next rung"));
    later(3400, () => {
      setBuyer((s) => ({ ...s, face: "neutral", bubble: null }));
      setSupplier((s) => ({ ...s, face: "neutral", bubble: null }));
    });
  };

  const accept = () => {
    clearAll();
    act("buyer", "ThumbsUp", "surprised", "Accept");
    send("buyer");
    later(900, () => {
      act("supplier", "Jump", "surprised", "Paid early");
      setPulseKey((k) => k + 1 + counter.current++);
      setSettled(true);
    });
    later(4200, () => {
      setBuyer((s) => ({ ...s, face: "neutral", bubble: null }));
      setSupplier((s) => ({ ...s, face: "neutral", bubble: null }));
    });
  };

  const reset = () => {
    clearAll();
    setSettled(false);
    setSupplier(REST);
    setBuyer(REST);
    setMessage(null);
  };

  const onSelect = (r: Role) => {
    setSelected(r);
    act(r, "ThumbsUp", "neutral", null);
  };

  const onHoverRole = (r: Role, over: boolean) => {
    setHover(over ? r : null);
    if (over) {
      const s = r === "supplier" ? supplier : buyer;
      // Hovering must not retrigger the wave while it plays or right after: it reads as flicker.
      const now = performance.now();
      if (s.pose === "Idle" && now - lastWave.current > 3500) {
        lastWave.current = now;
        act(r, "Wave", s.face, s.bubble);
      }
    }
  };

  return (
    <section id="agents" ref={section} className="agents">
      <div className="agents-copy">
        <h2 className="display-2">
          Two agents.
          <br />
          Two businesses.
          <br />
          One price.
        </h2>
        <p className="lede">
          Each business runs its own agent as a separate process with its own wallet. They share no internals, only
          signed messages and the chain.
        </p>
        <div className="role-cards" role="tablist" aria-label="Agent roles">
          {(Object.keys(ROLES) as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={selected === r}
              data-role={r}
              data-hot={hover === r}
              className="role-card"
              onClick={() => setSelected(r)}
              onMouseEnter={() => setHover(r)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="role-dot" />
              <span className="role-name">{ROLES[r].name}</span>
              <span className="muted role-tag">{ROLES[r].tag}</span>
            </button>
          ))}
        </div>
        <ul className="role-lines" aria-live="polite">
          {ROLES[selected].lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>

      <div className="stage">
        <div className="stage-canvas">
          {near && (
            <AgentStage
              supplier={supplier}
              buyer={buyer}
              selected={selected}
              onSelect={onSelect}
              onHover={onHoverRole}
              message={message}
              pulseKey={pulseKey}
              visible={visible}
            />
          )}
          {near && (
            <>
              <p className="stage-label stage-label-supplier">supplier agent</p>
              <p className="stage-label stage-label-buyer">buyer agent</p>
            </>
          )}
          {settled && <p className="stage-settled tag">{"{on-chain}"} Settled on Arc in USDC</p>}
        </div>
        <div className="stage-bar">
          <p className="muted stage-note">Illustration of the protocol&apos;s roles and reason codes. No live data.</p>
          <div className="stage-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={offer}>
              Post offer
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={reject}>
              Reject
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={accept}>
              Accept
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={reset}>
              Reset
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

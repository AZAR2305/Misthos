"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState, Face, Pose, Role } from "./AgentStage";
import { AgentTerminal, type Tag, type TermLine, type Tone } from "./AgentTerminal";
import { sceneState } from "./scene-store";

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

/** What a scenario step can do: say a line in the terminal, move a robot, or put one to work. */
interface Api {
  say(tag: Tag, text: string, tone?: Tone): void;
  act(who: Role, pose: Pose, face: Face, bubble: string | null): void;
  work(who: Role, on: boolean): void;
  settle(on: boolean): void;
}
type Step = [at: number, run: (a: Api) => void];
interface Scenario {
  id: string;
  label: string;
  end: number;
  steps: Step[];
}

/** No amounts and no rates anywhere in these: rungs and reason codes only. It is an illustration, not data. */
const SCENARIOS: Scenario[] = [
  {
    id: "climb",
    label: "Climb a rung",
    end: 11800,
    steps: [
      [200, (a) => (a.say("you", "misthos supplier start --invoice PO-2043"), a.work("supplier", true))],
      [1300, (a) => a.say("supplier", "invoice approved by the buyer. Ladder ready, starting at rung 0.")],
      [2600, (a) => (a.say("supplier", "signing offer: rung 0. Sent to the buyer agent."), a.act("supplier", "Wave", "neutral", "offer · rung 0"))],
      [3500, (a) => (a.work("supplier", false), a.work("buyer", true), a.say("buyer", "checking the offer against the private hurdle..."))],
      [5000, (a) => (a.work("buyer", false), a.say("buyer", "reject. reason=BELOW_HURDLE", "bad"), a.act("buyer", "No", "angry", "BELOW_HURDLE"), a.act("supplier", "Idle", "sad", null))],
      [6400, (a) => (a.work("supplier", true), a.say("supplier", "cost of waiting not reached. Climbing to rung 1."))],
      [7700, (a) => (a.say("supplier", "signing offer: rung 1. Sent to the buyer agent."), a.act("supplier", "Wave", "neutral", "offer · rung 1"))],
      [8500, (a) => (a.work("supplier", false), a.work("buyer", true), a.say("buyer", "hurdle met, cash available, within caps. Accepting rung 1.", "ok"))],
      [9600, (a) => (a.work("buyer", false), a.act("buyer", "ThumbsUp", "surprised", "accept"), a.say("buyer", "calling settleEarly() on InvoiceBook."))],
      [10600, (a) => (a.say("chain", "EarlySettled. Supplier paid in USDC, invoice closed once.", "ok"), a.settle(true), a.act("supplier", "Jump", "surprised", "paid early"), a.act("buyer", "Dance", "surprised", null))],
    ],
  },
  {
    id: "zero",
    label: "Accepted at 0%",
    end: 8600,
    steps: [
      [200, (a) => (a.say("you", "misthos supplier start --invoice PO-2044"), a.work("supplier", true))],
      [1300, (a) => a.say("supplier", "invoice approved. Opening at rung 0: no discount at all.")],
      [2600, (a) => (a.say("supplier", "signing offer: rung 0. Sent to the buyer agent."), a.act("supplier", "Wave", "neutral", "offer · rung 0"))],
      [3500, (a) => (a.work("supplier", false), a.work("buyer", true), a.say("buyer", "idle cash above the floor, no discount needed. Accepting rung 0.", "ok"))],
      [5000, (a) => (a.work("buyer", false), a.act("buyer", "ThumbsUp", "surprised", "accept"), a.say("buyer", "calling settleEarly() on InvoiceBook."))],
      [6300, (a) => (a.say("chain", "EarlySettled. Paid in USDC at a price of zero.", "ok"), a.settle(true), a.act("supplier", "Jump", "surprised", "paid at 0%"), a.act("buyer", "Dance", "surprised", null))],
    ],
  },
];

const RUN_IT = [
  { who: "Supplier agent", cmd: "pnpm --filter @misthos/agent supplier" },
  { who: "Buyer agent", cmd: "pnpm --filter @misthos/agent buyer" },
];

export function Agents({ compact = false }: { compact?: boolean }) {
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<Role>("supplier");
  const [supplier, setSupplier] = useState<AgentState>(REST);
  const [buyer, setBuyer] = useState<AgentState>(REST);
  const [lines, setLines] = useState<TermLine[]>([]);
  const [running, setRunning] = useState(false);
  const [settled, setSettled] = useState(false);
  const [which, setWhich] = useState(SCENARIOS[0]!.id);
  const [copied, setCopied] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const counter = useRef(1);
  const played = useRef(false);

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

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const api: Api = {
    say: (tag, text, tone) => setLines((l) => [...l, { id: counter.current++, tag, text, tone }]),
    act: (who, pose, face, bubble) => (who === "supplier" ? setSupplier : setBuyer)((s) => ({ ...s, pose, poseKey: s.poseKey + 1, face, bubble })),
    work: (who, on) => (who === "supplier" ? setSupplier : setBuyer)((s) => ({ ...s, working: on })),
    settle: setSettled,
  };

  const reset = useCallback(() => {
    clearAll();
    setSupplier(REST);
    setBuyer(REST);
    setLines([]);
    setSettled(false);
    setRunning(false);
  }, [clearAll]);

  const play = (id: string) => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    reset();
    setWhich(id);
    setRunning(true);
    // Reduced motion: show the whole transcript at once and leave the robots still.
    if (sceneState.reducedMotion) {
      const flat = { ...api, act: () => {}, work: () => {}, settle: () => {} };
      for (const [, run] of sc.steps) run(flat);
      setRunning(false);
      return;
    }
    for (const [at, run] of sc.steps) timers.current.push(window.setTimeout(() => run(api), at));
    timers.current.push(
      window.setTimeout(() => {
        setRunning(false);
        setSupplier((s) => ({ ...s, pose: "Idle", poseKey: s.poseKey + 1, face: "neutral", bubble: null, working: false }));
        setBuyer((s) => ({ ...s, pose: "Idle", poseKey: s.poseKey + 1, face: "neutral", bubble: null, working: false }));
      }, sc.end),
    );
  };

  // The first time the section scrolls into view, run one negotiation so the page shows what it is about.
  useEffect(() => {
    if (!near || !visible || played.current) return;
    played.current = true;
    const t = window.setTimeout(() => play(SCENARIOS[0]!.id), 900);
    return () => clearTimeout(t);
  }, [near, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(cmd);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked: the command is still on screen */
    }
  };

  return (
    <section id={compact ? undefined : "agents"} ref={section} className={compact ? "agents agents-compact" : "agents"}>
      {!compact && (
      <div className="agents-head">
        <h2 className="display-2">
          Two agents. Two businesses.
          <br />
          One price.
        </h2>
        <div className="agents-copy">
          <p className="lede">
            Each business runs its own agent as a separate process with its own wallet. They share no internals, only signed
            messages and the chain. Press play to watch one invoice get settled.
          </p>
          <div className="agent-tabs" role="tablist" aria-label="Agent roles">
            {(Object.keys(ROLES) as Role[]).map((r) => (
              <button key={r} type="button" role="tab" aria-selected={selected === r} data-role={r} className="agent-tab" onClick={() => setSelected(r)}>
                <span className="agent-dot" />
                <span className="agent-name">{ROLES[r].name}</span>
                <span className="muted agent-tag">{ROLES[r].tag}</span>
              </button>
            ))}
          </div>
          <ul className="agent-lines" aria-live="polite">
            {ROLES[selected].lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      </div>
      )}

      <div className="workbench">
        <div className="stage-canvas">
          {near && (
            <AgentStage supplier={supplier} buyer={buyer} selected={selected} onSelect={setSelected} onHover={() => {}} message={null} pulseKey={0} visible={visible} showChannel={false} />
          )}
          {near && (
            <>
              <p className="stage-label stage-label-supplier">supplier agent</p>
              <p className="stage-label stage-label-buyer">buyer agent</p>
            </>
          )}
          {settled && <p className="stage-settled tag">On-chain Settled on Arc in USDC</p>}
        </div>
        <div className="workbench-tty">
          <AgentTerminal lines={lines} running={running} instant={sceneState.reducedMotion} />
        </div>
      </div>

      <div className="stage-bar">
        <p className="muted stage-note">Illustration of the protocol&apos;s roles, rungs and reason codes. No live data, no amounts.</p>
        <div className="stage-actions">
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className={`btn btn-sm ${which === s.id && running ? "btn-primary" : "btn-ghost"}`} onClick={() => play(s.id)} disabled={running && which === s.id}>
              {running && which === s.id ? "Playing…" : `Play: ${s.label}`}
            </button>
          ))}
          <button type="button" className="btn btn-quiet btn-sm" onClick={reset}>
            Reset
          </button>
        </div>
      </div>

      <div className="runit">
        <p className="sec-eyebrow">Run the real agents</p>
        <ul>
          {RUN_IT.map((r) => (
            <li key={r.cmd}>
              <span className="muted">{r.who}</span>
              <code>{r.cmd}</code>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(r.cmd)}>
                {copied === r.cmd ? "Copied" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
        <p className="muted tiny">Each agent needs its own Circle wallet and a model key; the setup steps are in the developer kit.</p>
      </div>
    </section>
  );
}

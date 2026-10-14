"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSide } from "@/components/account/AccountProvider";
import type { AgentState, Pose } from "@/components/landing/AgentStage";
import { useSceneInput } from "@/components/landing/scene-store";
import { agentBus } from "@/lib/agent-bus";

const CompanionCanvas = dynamic(() => import("./CompanionCanvas"), { ssr: false });

const REST: AgentState = { pose: "Idle", poseKey: 0, face: "neutral", bubble: null, working: false };
const KEY = "misthos.companion.v1";

/** One plain sentence per page: what it is for, in the agent's voice. */
function tipFor(path: string): string | null {
  if (path === "/app") return "Start here. Pick a side and I will walk you through it.";
  if (path === "/supplier") return "These are your invoices. Anything approved can be offered for early payment.";
  if (path.startsWith("/supplier/invoices/new")) return "Fill this in once and sign it. I will price the wait for you.";
  if (path === "/buyer") return "Your spare USDC and what I would pay early with it.";
  if (path.startsWith("/buyer/approvals")) return "Approve the work here. Only approved invoices can be paid early.";
  if (path.startsWith("/buyer/policy")) return "Your limits. Nothing can move more than you allow.";
  if (path.startsWith("/invoices/")) return "One invoice from signing to payment. Every step links to the chain.";
  if (path === "/invoices") return "Every invoice on this network. Anyone can read it.";
  if (path.startsWith("/ledger")) return "A balanced journal of what was paid. You can export it.";
  if (path.startsWith("/stats")) return "Live numbers, recomputed from the chain. Nothing typed in.";
  return null;
}

/**
 * The agent character that lives in the corner of every app page. It follows the cursor, reads a one-line tip for the
 * page, types at its desk while something is being sent, and celebrates or sulks when it finishes. It is decoration and
 * guidance only: it never holds data and never acts on its own.
 */
export function AgentCompanion() {
  const path = usePathname();
  const { side } = useSide();
  useSceneInput();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(true);
  const [visible, setVisible] = useState(true);
  const [state, setState] = useState<AgentState>(REST);
  const [bubble, setBubble] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Dense pages (ledger, stats, tables, docs) stay clean: the agent lives on the home pages and drops in when something happens.
  const home = path === "/app" || path === "/supplier" || path === "/buyer" || path.startsWith("/claim/");
  const [guest, setGuest] = useState(false);
  const guestTimer = useRef<number | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const timers = useRef<number[]>([]);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const act = useCallback((pose: Pose, face: AgentState["face"] = "neutral") => setState((s) => ({ ...s, pose, face, poseKey: s.poseKey + 1 })), []);
  const say = useCallback(
    (text: string | null, ms = 7000) => {
      setBubble(text);
      if (text) later(ms, () => setBubble((b) => (b === text ? null : b)));
    },
    [later],
  );

  // A phone does not get a floating 3D character; the page is the point there.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 960px)");
    const on = () => setMounted(wide.matches);
    on();
    wide.addEventListener("change", on);
    try {
      setOpen(window.localStorage.getItem(KEY) !== "closed");
    } catch {
      /* storage blocked: stay open */
    }
    return () => {
      wide.removeEventListener("change", on);
      timers.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, open]);

  // Say hello once, then one tip the first time each page is opened this session.
  useEffect(() => {
    if (!mounted || !open) return;
    const tip = tipFor(path);
    if (!tip || seen.current.has(path)) return;
    seen.current.add(path);
    const first = seen.current.size === 1;
    later(first ? 1400 : 500, () => {
      act(first ? "Wave" : "Yes");
      say(tip);
    });
  }, [path, mounted, open, act, say, later]);

  useEffect(
    () =>
      agentBus.subscribe((e) => {
        setGuest(true);
        window.clearTimeout(guestTimer.current);
        guestTimer.current = window.setTimeout(() => setGuest(false), e.kind === "working" ? 90_000 : 8000);
        if (e.kind === "working") {
          setState((s) => ({ ...s, working: true, face: "neutral" }));
          say(e.text ? `${e.text}…` : "Working on it…", 60_000);
        } else if (e.kind === "done") {
          setState((s) => ({ ...s, working: false }));
          act("ThumbsUp", "surprised");
          say(e.text ?? "Done.", 5000);
          later(2500, () => act("Idle"));
        } else if (e.kind === "error") {
          setState((s) => ({ ...s, working: false }));
          act("No", "sad");
          say(e.text ?? "That did not go through. Nothing was sent.", 7000);
          later(3000, () => act("Idle"));
        } else {
          act("Wave");
          say(e.text ?? "Hello!", 4500);
        }
      }),
    [act, say, later],
  );

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(KEY, next ? "open" : "closed");
    } catch {
      /* ignore */
    }
  };

  // The agents page already has two agents on stage; a third in the corner would just be in the way.
  if (!mounted || path.startsWith("/agents") || (!home && !guest)) return null;
  if (!open) {
    return (
      <div className="companion-dock">
        <button type="button" className="companion-reopen" onClick={() => toggle(true)} aria-label="Show the agent">
          <span aria-hidden="true">◐</span> Agent
        </button>
      </div>
    );
  }
  return (
    <div className="companion-dock">
      <div className="companion" ref={box}>
        {bubble && (
          <div className="companion-bubble" role="status">
            <span className="tag">Agent</span> {bubble}
          </div>
        )}
        <div className="companion-canvas">
          <CompanionCanvas
            role={side ?? "supplier"}
            state={state}
            visible={visible}
            onSelect={() => {
              act("Wave");
              say(tipFor(path) ?? "I live here. Click me for a tip.");
            }}
          />
        </div>
        <button type="button" className="companion-x" onClick={() => toggle(false)} aria-label="Hide the agent">
          ×
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

export type Tag = "you" | "supplier" | "buyer" | "chain";
export type Tone = "plain" | "ok" | "warn" | "bad";
export interface TermLine {
  id: number;
  tag: Tag;
  text: string;
  tone?: Tone;
}

const LABEL: Record<Tag, string> = { you: "$", supplier: "supplier", buyer: "buyer", chain: "arc" };

/** Types the newest line out; older lines are already complete. Reduced motion shows everything at once. */
function Typed({ text, live, instant }: { text: string; live: boolean; instant: boolean }) {
  const [n, setN] = useState(live && !instant ? 0 : text.length);
  useEffect(() => {
    if (!live || instant) return setN(text.length);
    setN(0);
    const t = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(t), v) : v + 2)), 16);
    return () => clearInterval(t);
  }, [text, live, instant]);
  return <>{text.slice(0, n)}</>;
}

/**
 * A terminal window showing what the two agents are doing, one line at a time. It is a labelled illustration of the
 * protocol (roles, rungs and reason codes). It never shows amounts or rates, and it is not live data.
 */
export function AgentTerminal({ lines, running, instant, title = "misthos · negotiation" }: { lines: TermLine[]; running: boolean; instant: boolean; title?: string }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div className="tty" role="log" aria-live="polite" aria-label="Agent terminal, an illustration of the protocol">
      <div className="tty-bar">
        <span className="tty-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="tty-title">{title}</span>
        <span className="tty-state" data-running={running}>{running ? "running" : "idle"}</span>
      </div>
      <div className="tty-body" ref={body}>
        {lines.length === 0 && <p className="tty-hint">Press play and watch two agents settle one invoice.</p>}
        {lines.map((l, i) => (
          <p key={l.id} className="tty-line" data-tag={l.tag} data-tone={l.tone ?? "plain"}>
            <span className="tty-tag">{l.tag === "you" ? "$" : `[${LABEL[l.tag]}]`}</span>
            <span className="tty-text">
              <Typed text={l.text} live={i === lines.length - 1} instant={instant} />
              {i === lines.length - 1 && running && <span className="tty-caret" aria-hidden="true" />}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";

type Reply =
  | { kind: "answer"; text: string }
  | { kind: "confirm"; text: string; token: string }
  | { kind: "refused"; text: string };
type Line = { who: "you" | "agent"; text: string; token?: string; open?: boolean };

/**
 * Type to your own agent. The text goes to the agent process on your machine, which does exactly what it can map to one of its fixed actions or says it cannot.
 * Anything that moves money is described first and only happens when you press Confirm. Nothing here talks to a model or a wallet directly.
 */
export function AgentChat({ url, role }: { url: string; role: "supplier" | "buyer" }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const call = async (path: string, body: unknown): Promise<Reply> => {
    try {
      const r = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
      const j = (await r.json()) as { ok: boolean; data?: Reply; error?: { message?: string } };
      if (j.ok && j.data) return j.data;
      return { kind: "refused", text: j.error?.message ?? "The agent could not do that." };
    } catch {
      return { kind: "refused", text: "I could not reach your agent, so nothing was done." };
    }
  };
  const push = (...l: Line[]) => {
    setLines((cur) => [...cur, ...l]);
    window.setTimeout(() => end.current?.scrollIntoView({ block: "nearest" }), 0);
  };
  const show = (r: Reply) => push({ who: "agent", text: r.text, token: r.kind === "confirm" ? r.token : undefined, open: r.kind === "confirm" });
  const close = (token: string) => setLines((cur) => cur.map((l) => (l.token === token ? { ...l, open: false } : l)));

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    setBusy(true);
    push({ who: "you", text: t });
    show(await call("/chat", { text: t }));
    setBusy(false);
  };
  const decide = async (token: string, yes: boolean) => {
    close(token);
    setBusy(true);
    show(await call(yes ? "/chat/confirm" : "/chat/cancel", { token }));
    setBusy(false);
  };

  return (
    <div className="agent-chat" aria-label={`Talk to your ${role} agent`}>
      <div role="log" aria-live="polite" style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 8, marginBottom: 8 }}>
        {lines.length === 0 && <p className="muted tiny">Ask in plain words, for example “status”, “list invoices” or “help”. Anything that moves money asks you to confirm first.</p>}
        {lines.map((l, i) => (
          <div
            key={i}
            style={l.who === "agent" ? { background: "var(--color-agent-bg)", color: "var(--color-agent-text)", border: "1px solid var(--color-agent-border)", borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap" } : { padding: "2px 4px", whiteSpace: "pre-wrap" }}
          >
            {l.text}
            {l.open && l.token && (
              <div className="actions-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide(l.token!, true)}>Confirm</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void decide(l.token!, false)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
        {busy && <p className="muted tiny" role="status">Working on it. A payment can take a few minutes to settle on Arc.</p>}
        <div ref={end} />
      </div>
      <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
        <input className="input" aria-label="Message to your agent" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell your agent what to do" />
        <button type="submit" className="btn btn-ghost" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

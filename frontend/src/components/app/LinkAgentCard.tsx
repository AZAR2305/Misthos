"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AddressChip, Card, CodeBlock, Notice, Tag } from "@/components/ui/kit";
import { api, apiEnabled } from "@/lib/api";

/**
 * Link your agent to your business. Your agent reads your payment calendar and credit limits from your account, and it proves
 * it is itself by signing with its own wallet. For that it needs to be linked, and linking takes both halves: a one-time code
 * you make here while signed in, and your agent redeeming it. Nobody can link an agent they do not control, or attach yours to
 * their business.
 */
export function LinkAgentCard({ side }: { side: "buyer" | "supplier" }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "signed-out" } | { status: "unavailable"; reason: string } | { status: "ready"; linked: string[] }>({ status: apiEnabled ? "loading" : "unavailable", ...(apiEnabled ? {} : { reason: "This site is not connected to a Misthos server." }) } as never);
  const [code, setCode] = useState<{ code: string; minutes: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!apiEnabled) return;
    const r = await api<{ linked: string[] }>("/api/me/agent");
    if (!r.ok) return setState(r.error.code === "SIGNED_OUT" ? { status: "signed-out" } : { status: "unavailable", reason: r.error.message });
    setState({ status: "ready", linked: r.data.linked });
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (state.status !== "ready" || !code || state.linked.length === 0) return;
    setCode(undefined); // linked: the code is spent
  }, [state, code]);

  const make = async () => {
    setBusy(true);
    setError(undefined);
    const r = await api<{ code: string; minutes: number }>("/api/me/agent-link", { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setCode(r.data);
    // The agent redeems it within minutes, so check again for a while.
    for (const wait of [5_000, 10_000, 15_000, 30_000, 60_000]) window.setTimeout(() => void load(), wait);
  };

  return (
    <Card title="Link your agent" aside={<Tag tone="agent">agent</Tag>}>
      {state.status === "loading" ? (
        <p className="muted">Loading…</p>
      ) : state.status === "signed-out" ? (
        <Notice kind="info" title="Sign in to link your agent" action={<Link className="btn btn-ghost btn-sm" href="/login">Sign in</Link>}>
          Your agent reads your {side === "buyer" ? "payment calendar and " : ""}credit limits from your account, so it has to be linked to it.
        </Notice>
      ) : state.status === "unavailable" ? (
        <Notice kind="warn" title="Unavailable">Linking is not available right now: {state.reason}</Notice>
      ) : (
        <>
          {state.linked.length > 0 ? (
            <>
              <p className="muted">Your agent is linked. It reads your {side === "buyer" ? "payment calendar and " : ""}credit limits from your account, proved by a signature from its own wallet.</p>
              <ul className="checklist">{state.linked.map((a) => <li key={a}><AddressChip address={a} label="Agent wallet" /></li>)}</ul>
            </>
          ) : (
            <p className="muted">
              Not linked yet. Until it is, your agent cannot read your {side === "buyer" ? "payment calendar or " : ""}credit limits
              {side === "buyer" ? ", so it will accept nothing rather than guess" : ""}.
            </p>
          )}
          {code ? (
            <>
              <CodeBlock label="Add this to your agent's settings file, start the agent once, then remove it">{`MISTHOS_LINK_CODE=${code.code}`}</CodeBlock>
              <p className="muted tiny">Works once and expires in {code.minutes} minutes. Your agent signs the redeem request with its own wallet, so only the agent you start can use it.</p>
            </>
          ) : (
            <div className="actions-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void make()}>{busy ? "Making a code…" : state.linked.length > 0 ? "Link another agent" : "Make a link code"}</button>
            </div>
          )}
          {error && <p className="muted tiny" role="alert">{error}</p>}
        </>
      )}
    </Card>
  );
}

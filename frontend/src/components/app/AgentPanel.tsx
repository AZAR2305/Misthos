"use client";

import Link from "next/link";
import { walletNotice } from "@/lib/walletnotice";
import { Card, Notice } from "@/components/ui/kit";
import { useAgentHealth } from "@/lib/hooks";

/** Is this person's agent running? A plain answer, and the exact command to start it if not. */
export function AgentPanel({ role, url }: { role: "supplier" | "buyer"; url: string }) {
  const h = useAgentHealth(url);
  const name = role === "supplier" ? "Supplier agent" : "Buyer agent";
  return (
    <Card
      title={name}
      aside={
        <span className="health">
          <span className="dot" data-ok={h.state === "online" ? "true" : h.state === "checking" ? "unknown" : "false"} aria-hidden="true" />
          {h.state === "online" ? "Running" : h.state === "checking" ? "Checking" : "Not running"}
        </span>
      }
    >
      {h.state === "online" ? (
        <>
          <p className="muted">
            {role === "supplier"
              ? "Your agent can offer early payment on approved invoices, starting at 0%, and stops at the limit you set."
              : "Your agent answers offers, settles those that fit your policy, and plans the best set to pay early."}
          </p>
          {h.data.wallet && !h.data.wallet.ok && (() => {
            const n = walletNotice(h.data.wallet!.detail ?? "The wallet could not be checked.");
            return (
              <Notice kind="warn" title={n.title}>
                {n.body}
                {n.command && <pre className="code" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 8 }}>{n.command}</pre>}
              </Notice>
            );
          })()}
          {h.data.modelConfigured === false && <Notice kind="warn" title="No model key">Without a model key it takes no action on its own.</Notice>}
        </>
      ) : h.state === "offline" ? (
        <>
          <p className="muted">
            {role === "supplier" ? "A supplier agent can negotiate for you." : "A buyer agent can plan and settle for you."} You can do everything by hand without one.
          </p>
          <p className="muted tiny">Start your agent on your own machine and this panel connects to it.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={h.recheck}>Check again</button>
        </>
      ) : (
        <p className="muted">Looking for the agent…</p>
      )}
    </Card>
  );
}

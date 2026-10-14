"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExposurePolicyCard } from "@/components/app/ExposurePolicyCard";
import { LinkAgentCard } from "@/components/app/LinkAgentCard";
import { RequireWallet } from "@/components/app/RequireWallet";
import { Card, Field, Money, Notice, PageHeader, Tag, Term } from "@/components/ui/kit";
import { INVOICE_BOOK_ABI } from "@/lib/chain/abi";
import { appChain, publicClient } from "@/lib/chain/client";
import { readBuyerState, type BuyerChainState } from "@/lib/chain/invoices";
import { CONFIG } from "@/lib/config";
import { MoneyError, formatMinor, toMinor } from "@/lib/core";
import { useAgentHealth } from "@/lib/hooks";
import { useTx } from "@/lib/tx";

interface AgentPolicy { hurdleAprBps: number; liquidityFloor: string; perInvoiceCap: string; dailyCap: string; humanAbove: string; feeBps: number }

export default function Policy() {
  return (
    <>
      <PageHeader
        title="Policy and limits"
        lead="The guardrails that decide how much can ever move, and who decides when. Some are enforced by the contract, the rest by your agent."
        help={
          <>
            <p><b>Why limits matter.</b> An AI agent can be fooled by a clever message. So the limits that matter most live on the contract, where no prompt can change them: a cap per invoice, a cap per day, and a hard 50% yearly rate ceiling.</p>
            <p><b>On-chain</b> limits are changed here with a transaction. <b>Agent-side</b> settings (your hurdle, cash floor and sign-off amount) are private to your agent and set in its <span className="inline-code">agent/.env</span>, so they never leave your machine.</p>
          </>
        }
      />
      <RequireWallet why="Limits belong to your wallet. Connect the buyer's wallet to view or change them.">{(me) => <Body me={me} />}</RequireWallet>
    </>
  );
}

function Body({ me }: { me: `0x${string}` }) {
  const tx = useTx();
  const [state, setState] = useState<BuyerChainState | null>(null);
  const [per, setPer] = useState("");
  const [daily, setDaily] = useState("");
  const [touched, setTouched] = useState(false);
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const agent = useAgentHealth(CONFIG.buyerAgentUrl);

  const load = useCallback(async () => {
    if (!CONFIG.book) return;
    try {
      const s = await readBuyerState(publicClient(), CONFIG.book, CONFIG.usdc, me);
      setState(s);
      setPer((v) => (v === "" ? (s.perInvoiceCap === 0n ? "0" : formatMinor(s.perInvoiceCap).replace(/\.?0+$/, "")) : v));
      setDaily((v) => (v === "" ? (s.dailyCap === 0n ? "0" : formatMinor(s.dailyCap).replace(/\.?0+$/, "")) : v));
    } catch { /* banner covers it */ }
  }, [me]);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (agent.state !== "online") return setPolicy(null);
    fetch(`${CONFIG.buyerAgentUrl}/policy`).then((r) => r.json()).then((b: { ok: boolean; data?: AgentPolicy }) => b.ok && b.data && setPolicy(b.data)).catch(() => setPolicy(null));
  }, [agent.state]);

  const parse = (v: string): { ok: true; minor: bigint } | { ok: false; error: string } => {
    try { return { ok: true, minor: toMinor(v || "0") }; } catch (e) { return { ok: false, error: e instanceof MoneyError ? "Use a number with up to 6 decimals. Use 0 for no cap." : "Enter a number." }; }
  };
  const p = parse(per);
  const d = parse(daily);
  const dailyBelowPer = p.ok && d.ok && d.minor !== 0n && p.minor !== 0n && d.minor < p.minor;
  const valid = p.ok && d.ok && !dailyBelowPer;

  const save = async () => {
    setTouched(true);
    if (!valid || !p.ok || !d.ok) return;
    const hash = await tx.run({ pending: "Saving limits", done: "Limits saved" }, (wc, account) =>
      wc.writeContract({ address: CONFIG.book!, abi: INVOICE_BOOK_ABI, functionName: "setLimits", args: [p.minor, d.minor], account, chain: appChain }),
    );
    if (hash) void load();
  };

  return (
    <>
    <div className="split">
      <Card title="Limits enforced by the contract" aside={<Tag>on-chain</Tag>}>
        <p className="muted">These apply to every early payment from your wallet, whoever or whatever triggers it. Set 0 for no cap.</p>
        <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <Field label="Per-invoice cap (USDC)" htmlFor="per" error={touched && !p.ok ? p.error : undefined} hint={<>The most you will pay for one invoice, counting the <Term tip="A small share of the discount, paid by the buyer on top. Zero when the rate is zero.">success fee</Term>.</>}>
            <input id="per" className="input" inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} />
          </Field>
          <Field label="Daily cap (USDC)" htmlFor="daily" error={touched ? (!d.ok ? d.error : dailyBelowPer ? "The daily cap cannot be lower than the per-invoice cap." : undefined) : undefined} hint="The most you will pay early in one day, across all invoices.">
            <input id="daily" className="input" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </Field>
          <div className="actions-row">
            <button type="submit" className="btn btn-primary" disabled={!!tx.busy || !CONFIG.book}>{tx.busy ? `${tx.busy}…` : "Save limits"}</button>
            <span className="muted tiny">One transaction from your wallet.</span>
          </div>
        </form>
        {state && (
          <dl className="kv">
            <div><dt>Current per-invoice cap</dt><dd>{state.perInvoiceCap === 0n ? "No cap" : <Money minor={state.perInvoiceCap} />}</dd></div>
            <div><dt>Current daily cap</dt><dd>{state.dailyCap === 0n ? "No cap" : <Money minor={state.dailyCap} />}</dd></div>
            <div><dt>Spent early today</dt><dd><Money minor={state.spentToday} /></dd></div>
            <div><dt>Rate ceiling (fixed)</dt><dd>50% a year</dd></div>
          </dl>
        )}
      </Card>

      <Card title="Your agent's private settings" aside={<Tag tone="agent">agent</Tag>}>
        {policy ? (
          <>
            <dl className="kv">
              <div><dt><Term tip="The lowest yearly rate you accept. It is never shared with the supplier or shown before settlement.">Hurdle rate</Term></dt><dd>{(policy.hurdleAprBps / 100).toFixed(2)}% a year</dd></div>
              <div><dt><Term tip="Cash your agent keeps untouched, whatever the offers.">Liquidity floor</Term></dt><dd><Money minor={BigInt(policy.liquidityFloor)} /></dd></div>
              <div><dt><Term tip="Payments above this wait for you instead of being settled automatically.">Sign-off above</Term></dt><dd>{BigInt(policy.humanAbove) === 0n ? "Never asks" : <Money minor={BigInt(policy.humanAbove)} />}</dd></div>
              <div><dt>Success fee</dt><dd>{(policy.feeBps / 100).toFixed(1)}% of the discount</dd></div>
            </dl>
            <p className="muted tiny">Read from your own agent on this machine. To change them, edit your agent's settings file and restart it (<Link href="/docs/run-the-agents">how</Link>).</p>
          </>
        ) : (
          <Notice kind="info" title="Your buyer agent is not running">
            Its hurdle, cash floor and sign-off amount are set in your agent's settings file (see <Link href="/docs/run-the-agents">Run the agents</Link>). Start it to see them here.
          </Notice>
        )}
        <p className="muted tiny">These stay in your agent&apos;s process. They are the reason a reject only ever says &quot;below hurdle&quot; and never what the hurdle is.</p>
      </Card>
    </div>
    <ExposurePolicyCard side="buyer" />
    <LinkAgentCard side="buyer" />
    </>
  );
}

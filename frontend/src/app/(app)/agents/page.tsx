"use client";

import { Card, CodeBlock, Notice, PageHeader, Tag, Term } from "@/components/ui/kit";
import { AddressChip, Money } from "@/components/ui/kit";
import Link from "next/link";
import { Agents as AgentsShowcase } from "@/components/landing/Agents";
import { CONFIG } from "@/lib/config";
import { useAgentHealth, useUsdcBalance } from "@/lib/hooks";

const REASONS: Array<[string, string]> = [
  ["BELOW_HURDLE", "The offered rate is under the buyer's private minimum. The minimum itself is never revealed."],
  ["LIQUIDITY_FLOOR", "Paying would take the buyer's cash under the floor it keeps."],
  ["NOT_ELIGIBLE", "The invoice is not approved, is already due, or the offer breaks a cap."],
  ["NEEDS_HUMAN_APPROVAL", "The payment is above the amount the buyer signs off personally, so a person decides."],
  ["EXPIRED", "The offer ran out of time before it was accepted."],
  ["DISPUTED", "The buyer disputed the invoice."],
  ["REPUTATION_FLAG", "A record of past behaviour blocks early payment."],
];

export default function Agents() {
  return (
    <>
      <PageHeader
        title="The agents"
        lead="Two independent programs, one for each business. They negotiate the price of waiting in signed messages and never see each other's private numbers."
        help={
          <>
            <p><b>Why two?</b> Each side has secrets. The supplier knows what waiting costs it. The buyer knows its minimum rate and its cash plan. If one program held both, one side would have to trust the other. So each runs separately, with its own wallet, and they only exchange signed messages.</p>
            <p><b>What an agent can and cannot do.</b> An AI model may suggest where to start and what to flag, but it can never sign or send anything. Plain code checks every number, and the contract has the final say. If the model, the wallet or the network fails, the agent does nothing and asks a person.</p>
          </>
        }
      />
      <AgentsShowcase compact />
      <div className="grid-2">
        <Agent role="supplier" />
        <Agent role="buyer" />
      </div>

      <Card title="How they talk">
        <ol className="timeline">
          <li><span className="rung">1</span><span>The supplier agent signs an offer, starting at 0%, and sends it.</span><span className="when">signed</span></li>
          <li><span className="rung">2</span><span>The buyer agent checks the signature, the invoice and its own rules.</span><span className="when">code</span></li>
          <li><span className="rung">3</span><span>It either pays at that rate, or answers with a reason code and never the number behind it.</span><span className="when">signed</span></li>
          <li><span className="rung">4</span><span>If rejected, the supplier signs the next rung, a little higher, up to its own limit.</span><span className="when">≤ 6 rungs</span></li>
        </ol>
        <details className="help" open>
          <summary>The seven reason codes</summary>
          <div className="help-body">{REASONS.map(([c, d]) => <p key={c}><b className="mono">{c}</b> {d}</p>)}</div>
        </details>
      </Card>
    </>
  );
}

function Agent({ role }: { role: "supplier" | "buyer" }) {
  const url = role === "supplier" ? CONFIG.supplierAgentUrl : CONFIG.buyerAgentUrl;
  const address = role === "supplier" ? CONFIG.supplierAgentAddress : CONFIG.buyerAgentAddress;
  const h = useAgentHealth(url);
  const { balance } = useUsdcBalance(address);
  const title = role === "supplier" ? "Supplier agent" : "Buyer agent";
  return (
    <Card
      title={title}
      aside={<span className="health"><span className="dot" data-ok={h.state === "online" ? "true" : h.state === "checking" ? "unknown" : "false"} aria-hidden="true" />{h.state === "online" ? "Running" : h.state === "checking" ? "Checking" : "Not running"}</span>}
    >
      <p className="muted">
        {role === "supplier"
          ? "Decides whether to accelerate an invoice, where to start, how far to climb and when to stop. Holds its cost of waiting privately."
          : "Chooses which approved invoices to pay early with limited cash, answers offers, and explains its plan. Holds its minimum rate privately."}
      </p>
      <dl className="kv">
        <div><dt>Wallet</dt><dd>{address ? <AddressChip address={address} /> : <span className="muted">Not set for this site</span>}</dd></div>
        <div><dt>Wallet type</dt><dd>Circle Agent Wallet <Tag>circle-agent-wallet</Tag></dd></div>
        <div><dt>USDC</dt><dd>{balance === null ? <span className="muted">unavailable</span> : <Money minor={balance} accent />}</dd></div>
        <div><dt>Address on this machine</dt><dd className="mono tiny">{url}</dd></div>
        <div><dt><Term tip="A public identity and reputation record on Arc for agents (ERC-8004). Planned.">On-chain identity</Term></dt><dd className="muted">Not registered yet <Tag>erc-8004</Tag></dd></div>
        <div><dt>Skills</dt><dd>{role === "supplier" ? "quote-early-payment" : "respond-to-offer"}</dd></div>
      </dl>
      {h.state === "online" ? (
        <>
          {h.data.wallet && !h.data.wallet.ok && <Notice kind="warn" title="Its wallet needs attention">{h.data.wallet.detail}</Notice>}
          {h.data.modelConfigured === false && <Notice kind="warn" title="No model key">It will not act on its own without one.</Notice>}
        </>
      ) : h.state === "offline" ? (
        <>
          <p className="muted tiny">Start it on the machine that holds its wallet:</p>
          <CodeBlock>{`pnpm --filter @misthos/agent ${role}`}</CodeBlock>
          <p className="muted tiny">First check what is missing with <span className="inline-code">pnpm --filter @misthos/agent doctor</span>. Setup steps: <Link className="link" href="/docs/run-the-agents">Run the agents</Link>.</p>
        </>
      ) : null}
    </Card>
  );
}

"use client";

import Link from "next/link";
import { Card, PageHeader, Stepper, Notice } from "@/components/ui/kit";
import { useChainData } from "@/components/app/ChainData";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CONFIG } from "@/lib/config";
import { useAgentHealth, useUsdcBalance } from "@/lib/hooks";
import { useAccount, useSide } from "@/components/account/AccountProvider";
import { Onboarding } from "@/components/app/Onboarding";
import { WalletCard } from "@/components/app/WalletCard";
import { WalletGate } from "@/components/app/Gate";
import { ROLE_HOME, RoleChoice } from "@/components/app/RoleChoice";
import { Skeleton } from "@/components/ui/kit";

/** The front door: who you are, what to set up, and what a payment looks like. Every check reads real state. */
export default function StartHere() {
  const w = useWallet();
  const acct = useAccount();
  const { side: role, ready: roleReady, set: setRole } = useSide();
  // With a server, onboarding is Google, then wallet, then side. Without one it is just wallet, then side.
  if (acct.mode === "on") return acct.status === "ready" && acct.me?.step === "ready" && acct.me.side ? <Overview role={acct.me.side} /> : <Onboarding />;
  if (w.status !== "connected" || !w.address) return w.status === "connecting" ? <Skeleton rows={4} /> : <WalletGate />;
  if (!roleReady) return <Skeleton rows={4} />;
  if (!role) return <RoleChoice address={w.address} onChoose={setRole} />;
  return <Overview role={role} />;
}

function Overview({ role }: { role: "supplier" | "buyer" }) {
  const w = useWallet();
  const acct = useAccount();
  const { set: setRole } = useSide();
  const other = role === "supplier" ? "buyer" : "supplier";
  const chain = useChainData();
  const { balance } = useUsdcBalance(w.address);
  const buyerAgent = useAgentHealth(CONFIG.buyerAgentUrl);
  const supplierAgent = useAgentHealth(CONFIG.supplierAgentUrl);

  const checks = [
    ...(acct.mode === "on"
      ? [{ done: !!acct.me, text: "Signed in with Google", help: acct.me ? `${acct.me.email}, wallet ${acct.me.address ? acct.me.address.slice(0, 6) + "…" + acct.me.address.slice(-4) : "not linked"}` : "Sign in to act as a supplier or buyer.", action: undefined as React.ReactNode }]
      : []),
    { done: w.status === "connected", text: "Connect a wallet", help: "Use the button at the top right. A browser wallet signs invoices and payments.", action: w.status === "connected" ? undefined : <button type="button" className="btn btn-primary btn-sm" onClick={w.openModal}>Connect wallet</button> },
    { done: w.status === "connected" && w.onRightNetwork, text: `Be on ${CONFIG.networkName}`, help: "Your wallet must use the same network as this site.", action: w.status === "connected" && !w.onRightNetwork ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => void w.switchNetwork()}>Switch network</button> : undefined },
    { done: !!CONFIG.book, text: "The InvoiceBook contract is deployed", help: CONFIG.book ? "It is live on this network." : "This build has no contract address yet, so there is nothing to read or sign." },
    { done: balance !== null && balance > 0n, text: "Hold some USDC", help: `USDC pays invoices and the small network fee. Free test USDC: ${CONFIG.faucetUrl.replace("https://", "")}.`, action: <a className="btn btn-ghost btn-sm" href={CONFIG.faucetUrl} target="_blank" rel="noreferrer">Get test USDC</a> },
    { done: buyerAgent.state === "online" || supplierAgent.state === "online", text: "Optional: run an agent", help: "Agents negotiate the price for you. Without one you can still sign and pay by hand." },
  ];

  return (
    <>
      <PageHeader
        title="Start here"
        lead="Misthos lets a supplier be paid days after an invoice is approved, at a price two agents agree. Pick your side, check your setup, and go."
        help={
          <>
            <p><b>The idea.</b> A supplier normally waits about a month to be paid. A buyer with spare cash can pay sooner and keep a small discount. Misthos finds the fair price of waiting. When the buyer&apos;s cash is idle, that price is often 0%.</p>
            <p><b>Who does what.</b> Suppliers create and sign invoices. Buyers approve them and decide what to pay early. Each can run an agent that negotiates, but a person can always do it by hand.</p>
            <p><b>Safety.</b> Everything binding is enforced by a contract on Arc: caps, a 50% rate ceiling and single-use offers.</p>
          </>
        }
      />

      <section className="card welcome" data-role={role}>
        <div>
          <p className="ptag">{role === "supplier" ? "Supplier" : "Buyer"}</p>
          <h2>{role === "supplier" ? "You are set up as a supplier" : "You are set up as a buyer"}</h2>
          <p className="muted">
            {role === "supplier"
              ? "Create and sign invoices, then offer early payment from 0%."
              : "Approve invoices, then pay early with spare cash and keep the discount."}
          </p>
        </div>
        <div className="actions-row">
          <Link className="btn btn-primary" href={ROLE_HOME[role]}>Open my {role} dashboard</Link>
          <Link className="btn btn-ghost" href={role === "supplier" ? "/supplier/invoices/new" : "/buyer/approvals"}>{role === "supplier" ? "New invoice" : "Approvals"}</Link>
          <button type="button" className="btn btn-ghost" onClick={() => { setRole(other); }}>Switch to {other}</button>
        </div>
      </section>

      <WalletCard />

      <Card title="Your setup" aside={<span className="muted tiny">Live checks</span>}>
        <ul className="checklist">
          {checks.map((c) => (
            <li key={c.text}>
              <span className="check" data-done={c.done} aria-hidden="true">{c.done ? "✓" : ""}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 500 }}>{c.text}</p>
                <p className="muted tiny">{c.help}</p>
              </div>
              {c.action}
            </li>
          ))}
        </ul>
        {chain.status === "ready" && <p className="muted tiny">{chain.invoices.length} invoice{chain.invoices.length === 1 ? "" : "s"} on this network so far.</p>}
      </Card>

      <Card title="How one invoice is paid early">
        <Stepper steps={["Supplier signs", "Registered on Arc", "Buyer approves", "Offer agreed", "Paid in USDC"]} current={-1} />
        <p className="muted">
          1. The supplier signs the invoice. 2. It is recorded on Arc. 3. The buyer approves the work. 4. The supplier&apos;s offer, from 0% upward,
          is accepted at or above what the buyer needs. 5. The contract pays the supplier and closes the invoice exactly once.
        </p>
      </Card>

      {!CONFIG.book && (
        <Notice kind="info" title="Want to try it before the contract is deployed on Arc?">
          The developer kit shows how to run everything on a local test chain in a few minutes. <Link href="/kit" className="link">Open the developer kit</Link>.
        </Notice>
      )}
    </>
  );
}

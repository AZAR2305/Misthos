"use client";

import Link from "next/link";
import { Card, PageHeader, Stepper, Notice } from "@/components/ui/kit";
import { useChainData } from "@/components/app/ChainData";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CONFIG } from "@/lib/config";
import { useAgentHealth, useUsdcBalance } from "@/lib/hooks";
import { useRole } from "@/lib/storage";

/** The front door: who you are, what to set up, and what a payment looks like. Every check reads real state. */
export default function StartHere() {
  const w = useWallet();
  const chain = useChainData();
  const { balance } = useUsdcBalance(w.address);
  const buyerAgent = useAgentHealth(CONFIG.buyerAgentUrl);
  const supplierAgent = useAgentHealth(CONFIG.supplierAgentUrl);
  const [role, setRole] = useRole();

  const checks = [
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

      <div className="role-grid">
        <section className="role-tile">
          <p className="ptag">{"{supplier}"}</p>
          <h3>I am owed money</h3>
          <ul>
            <li>Create an invoice and sign it once.</li>
            <li>Offer early payment from 0%, and see the price in dollars first.</li>
            <li>Get paid in USDC the moment the buyer accepts.</li>
          </ul>
          <div className="actions-row">
            <Link className="btn btn-primary" href="/supplier" onClick={() => setRole("supplier")}>Open supplier dashboard</Link>
            <Link className="btn btn-ghost" href="/supplier/invoices/new">New invoice</Link>
          </div>
        </section>
        <section className="role-tile">
          <p className="ptag">{"{buyer}"}</p>
          <h3>I owe money</h3>
          <ul>
            <li>Approve invoices when the work is done.</li>
            <li>Pay early with spare cash and keep the discount.</li>
            <li>Set caps so nothing can move more than you allow.</li>
          </ul>
          <div className="actions-row">
            <Link className="btn btn-primary" href="/buyer" onClick={() => setRole("buyer")}>Open buyer dashboard</Link>
            <Link className="btn btn-ghost" href="/buyer/approvals">Approvals</Link>
          </div>
        </section>
      </div>
      {role && <p className="muted tiny">You last chose {role}. You can use both sides with the same wallet.</p>}

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

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useChainData } from "@/components/app/ChainData";
import { Card, Money, PageHeader, Stat } from "@/components/ui/kit";
import { CONFIG, addressUrl } from "@/lib/config";
import { settlementRows, summarise } from "@/lib/stats";

const TOUR = [
  { href: "/stats", title: "Live stats", text: "Numbers recomputed from chain events in your browser: how many invoices were paid early, how much cash moved, and how many cleared at a price of zero." },
  { href: "/invoices", title: "One invoice, start to finish", text: "Open any invoice: signed, registered, approved, offered, paid. Every step links to the explorer, and the discount curve is the contract's own arithmetic." },
  { href: "/agents", title: "The two agents at work", text: "Press play to watch a supplier agent and a buyer agent settle an invoice, including the case where the price is 0%. The reason codes are the real ones." },
  { href: "/ledger", title: "The books", text: "A balanced double-entry journal for every settlement, with CSV and beancount export, and the agents' hash-chained decision log." },
  { href: "/claim/example", title: "What a supplier sees", text: "A buyer can invite a supplier with one link, no account needed. The supplier checks the terms and signs with the wallet the invoice already names. (Needs a real link from a buyer.)" },
  { href: "/kit", title: "Run it yourself", text: "The developer kit: clone, test the contract, run a local chain, start both agents. Open source, MIT licensed." },
];

const BUILT = [
  "InvoiceBook contract: signatures (including contract wallets), caps, a 50% rate ceiling, single-use offers, settle-once. 40 tests.",
  "Two agents as separate processes with a signed negotiation protocol, a cash-aware allocator and a hash-chained decision log. 73 tests.",
  "A backend with an API, a chain indexer, a durable job outbox and a relayer that pays gas to register invoices for suppliers. Tested against a real local chain.",
  "Google sign-in linked to one wallet and one side, with a one-time nonce, site-bound wallet message and rate limits.",
  "Claim links: a buyer invites a supplier with no account; the supplier signs; the buyer pays with the stored signature, cleared at 0% in the end-to-end test.",
  "Ledger CSV and beancount export, public live stats, and an end-to-end browser test of the whole flow.",
];
const PENDING = [
  "A live run with a real Circle Agent Wallet on Arc testnet (needs the owner's Circle login and funded wallets).",
  "The deployed contract address on Arc testnet and the live link.",
  "Real pilot invoices from real businesses. Until then, all figures are testnet activity and say so.",
];
const NOT_YET = [
  "ERC-8004 identity and reputation, the MCP server, A2A agent cards.",
  "Managed Circle wallets for non-technical suppliers (suppliers use their own wallet today).",
  "Sealed-bid rounds and the EURC leg.",
];

/** A public, read-only page for anyone judging the project: what to click, what is real, and what is not done yet. */
export default function Judge() {
  const chain = useChainData();
  const rows = useMemo(() => settlementRows(chain.invoices, chain.time), [chain.invoices, chain]);
  const s = useMemo(() => summarise(rows), [rows]);
  const live = chain.status === "ready";

  return (
    <>
      <PageHeader
        title="For judges"
        lead="A ten-minute tour. Everything here is public and read-only: no wallet and no account needed."
        help={
          <>
            <p><b>What Misthos is.</b> Two agents, one per business, agree the price of paying an approved invoice early, starting at 0% and often ending there. A contract on Arc enforces the signed terms and settles in USDC.</p>
            <p><b>Honesty rules.</b> No mock or seeded data anywhere. A number the site cannot read shows as unavailable. Figures below are recomputed from the chain, and test runs count as testnet activity, not customers.</p>
          </>
        }
      />

      <div className="stats">
        <Stat label="Paid early" value={live ? s.count : "n/a"} hint={live ? "Invoices, on this network" : "Chain not readable yet"} />
        <Stat label="Cash moved" value={live ? <Money minor={s.net} accent /> : "n/a"} hint="USDC paid to suppliers" />
        <Stat label="Cleared at 0%" value={live && s.zeroSharePct !== null ? `${s.zeroSharePct}%` : "n/a"} hint="Paid early for nothing" />
        <Stat label="Invoices registered" value={live ? chain.invoices.length : "n/a"} hint={CONFIG.networkName} />
      </div>
      <p className="muted tiny">
        All activity on {CONFIG.networkName}, including the team&apos;s own test runs. It is not a measure of customers.{" "}
        {CONFIG.book ? <>Contract: <a className="link mono" href={addressUrl(CONFIG.book)} target="_blank" rel="noreferrer">{CONFIG.book.slice(0, 8)}…{CONFIG.book.slice(-6)}</a>.</> : "The contract is not deployed on this network yet."}
      </p>

      <Card title="The tour: click in this order">
        <ol className="tour">
          {TOUR.map((t, i) => (
            <li key={t.href}>
              <span className="tour-n">{i + 1}</span>
              <div>
                <b>{t.title}</b>
                <p className="muted">{t.text}</p>
              </div>
              {t.href === "/claim/example" ? <span className="muted tiny">Needs a link</span> : <Link className="btn btn-ghost btn-sm" href={t.href}>Open</Link>}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid-2">
        <Card title="Built and tested">
          <ul className="checklist">
            {BUILT.map((b) => (
              <li key={b}><span className="check" data-done="true" aria-hidden="true">✓</span><span className="muted">{b}</span></li>
            ))}
          </ul>
        </Card>
        <div className="stack">
          <Card title="Needs the owner's accounts">
            <ul className="checklist">
              {PENDING.map((b) => (
                <li key={b}><span className="check" data-done="false" aria-hidden="true" /><span className="muted">{b}</span></li>
              ))}
            </ul>
          </Card>
          <Card title="Not built yet">
            <ul className="checklist">
              {NOT_YET.map((b) => (
                <li key={b}><span className="check" data-done="false" aria-hidden="true" /><span className="muted">{b}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card title="Honest limits">
        <ul className="agent-lines">
          <li>The mechanism exists in web2 (dynamic discounting). What is new here is buyer-side agents, claim links, a price that can be zero, and an open kit.</li>
          <li>The main value is supplier liquidity, not yield. Only approved invoices can be accelerated, and the buyer still carries dispute and performance risk.</li>
          <li>An early payment from the buyer&apos;s own cash is not a loan, but rules vary by country. This is not legal advice.</li>
          <li>Circle Agent Wallet spending policies are mainnet-only, so the caps live in our contract.</li>
          <li>Testnet only, and the contract is unaudited.</li>
        </ul>
      </Card>
    </>
  );
}

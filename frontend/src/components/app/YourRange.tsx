"use client";

import { Card, Money, Notice, Tag, Term } from "@/components/ui/kit";
import { CONFIG } from "@/lib/config";
import { useAgentRange } from "@/lib/hooks";

const pct = (bps: number) => `${(bps / 100).toFixed(2)}% a year`;
const PROVENANCE: Record<string, string> = { onchain: "on-chain", policy: "policy", declared: "declared", unavailable: "unavailable" };
const INPUT_LABEL: Record<string, string> = { balance: "Balance", reserve: "Reserve", obligations: "Payments you listed", caps: "Caps", exposure: "Credit limit" };
const BINDING: Record<string, string> = {
  hurdle: "your hurdle rate",
  liquidity: "the cash you can spare above your reserve and your listed payments",
  cap: "your per-invoice or daily cap",
  exposure: "your credit limit for this supplier",
};

interface BuyerRange {
  state: "ok" | "closed" | "unavailable";
  missing?: string[];
  creditLimit?: "set" | "not set";
  ceiling?: {
    kind: "ok" | "unavailable";
    missing?: string[];
    available?: string;
    maxPay?: string;
    minRateBps?: number | null;
    binding?: string | null;
    inputs?: Array<{ ref: string; provenance: string }>;
  };
}
interface SupplierRange {
  state: "ok" | "closed";
  floor?: { maxRateBps: number; floorNet: string; askNet: string };
}

/**
 * The connected owner's own side of the range for one invoice, asked of their own agent. It shows the private numbers (the
 * lowest rate you would accept, or the highest you would sign), so it is only ever read from an agent on this machine and is
 * never sent to the other side. Where a number came from is shown, and anything the agent could not read says so.
 */
export function YourRange({ side, invoiceId }: { side: "buyer" | "supplier"; invoiceId: string }) {
  const url = side === "buyer" ? CONFIG.buyerAgentUrl : CONFIG.supplierAgentUrl;
  const r = useAgentRange<BuyerRange | SupplierRange>(url, invoiceId);
  const title = side === "buyer" ? "Your range as buyer" : "Your range as supplier";

  return (
    <Card title={title} tone="agent" aside={<Tag tone="agent">private</Tag>}>
      {r.status === "checking" ? (
        <p className="muted">Asking your agent…</p>
      ) : r.status === "offline" ? (
        <p className="muted">Unavailable: your {side} agent is not running on this machine, so its range cannot be shown. The range is private and is never stored on the server.</p>
      ) : r.status === "error" ? (
        <Notice kind="error" title="Your agent could not answer">{r.error}</Notice>
      ) : side === "supplier" ? (
        <SupplierBody d={r.data as SupplierRange} />
      ) : (
        <BuyerBody d={r.data as BuyerRange} />
      )}
    </Card>
  );
}

function SupplierBody({ d }: { d: SupplierRange }) {
  if (d.state === "closed" || !d.floor) return <p className="muted">Nothing to decide: this invoice is no longer open to early payment.</p>;
  return (
    <>
      <dl className="kv">
        <div><dt><Term tip="The highest yearly rate your agent will ever sign for this invoice. It comes from your cost of waiting, with a safety margin.">Highest rate you will sign</Term></dt><dd>{pct(d.floor.maxRateBps)}</dd></div>
        <div><dt><Term tip="What you would receive at that highest rate. Your agent signs nothing that pays you less.">Least you will receive</Term></dt><dd><Money minor={BigInt(d.floor.floorNet)} accent /></dd></div>
        <div><dt>Full price (at 0%)</dt><dd><Money minor={BigInt(d.floor.askNet)} /></dd></div>
      </dl>
      <p className="muted tiny">Your agent starts low and climbs toward this, never above it. The buyer never sees it.</p>
    </>
  );
}

function BuyerBody({ d }: { d: BuyerRange }) {
  if (d.state === "closed") return <p className="muted">Nothing to decide: this invoice is not open to early payment.</p>;
  if (d.state === "unavailable") return <Notice kind="warn" title="Unavailable">Your agent could not read what it needs, so it would accept nothing right now. {d.missing?.join(" ")}</Notice>;
  const c = d.ceiling;
  if (!c || c.kind === "unavailable") return <Notice kind="warn" title="Unavailable">Your agent could not read your balance or your listed payments, so it would accept nothing right now.</Notice>;
  return (
    <>
      <dl className="kv">
        {c.minRateBps === null || c.minRateBps === undefined ? (
          <div><dt>Lowest rate you accept</dt><dd>None: no rate fits right now</dd></div>
        ) : (
          <div><dt><Term tip="Your agent rejects any offer below this yearly rate. It is the highest of your hurdle and what your cash and limits allow.">Lowest rate you accept</Term></dt><dd>{pct(c.minRateBps)}</dd></div>
        )}
        {c.binding && <div><dt>Set by</dt><dd>{BINDING[c.binding] ?? c.binding}</dd></div>}
        <div><dt>Cash you can spare</dt><dd>{c.available !== undefined ? <Money minor={BigInt(c.available)} /> : "unavailable"}</dd></div>
        <div><dt>Most you could pay for this invoice</dt><dd>{c.maxPay !== undefined ? <Money minor={BigInt(c.maxPay)} accent /> : "unavailable"}</dd></div>
        <div><dt>Credit limit</dt><dd>{d.creditLimit === "set" ? "Applied" : "Not set"}</dd></div>
      </dl>
      {c.inputs && (
        <p className="muted tiny">
          Where each number came from:{" "}
          {c.inputs.map((i, k) => <span key={i.ref}>{k > 0 ? ", " : ""}{INPUT_LABEL[i.ref] ?? i.ref} <Tag>{PROVENANCE[i.provenance] ?? i.provenance}</Tag></span>)}
        </p>
      )}
      <p className="muted tiny">A payment you listed yourself is only as reliable as your list, so it is marked declared. It can lower what your agent pays, never raise it.</p>
    </>
  );
}

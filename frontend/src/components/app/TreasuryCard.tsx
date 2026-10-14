"use client";

import { useEffect, useState } from "react";
import { Card, Money, Tag, Term } from "@/components/ui/kit";
import { CONFIG } from "@/lib/config";
import type { StoredObligations } from "@/lib/storage";

/**
 * Cash you can spare (SRS view A): the verified USDC balance, less the reserve your agent keeps, less the payments you listed.
 * Each number says where it came from. The reserve is your agent's private setting, so it is read from your own agent on this
 * machine; if the agent is not running the reserve, and so the spare cash, say unavailable instead of guessing zero.
 */
export function TreasuryCard({ balance, obligations, source }: { balance: bigint | null; obligations: StoredObligations; source: "server" | "browser" }) {
  const [floor, setFloor] = useState<bigint | null | "loading">("loading");
  useEffect(() => {
    if (!CONFIG.buyerAgentUrl) return setFloor(null);
    let live = true;
    fetch(`${CONFIG.buyerAgentUrl}/policy`, { signal: AbortSignal.timeout(2500) })
      .then((r) => r.json())
      .then((b: { ok: boolean; data?: { liquidityFloor?: string } }) => live && setFloor(b.ok && typeof b.data?.liquidityFloor === "string" && /^\d+$/.test(b.data.liquidityFloor) ? BigInt(b.data.liquidityFloor) : null))
      .catch(() => live && setFloor(null));
    return () => {
      live = false;
    };
  }, []);

  const listed = obligations.reduce((sum, o) => sum + BigInt(o.amount), 0n);
  const known = balance !== null && floor !== "loading" && floor !== null;
  const spare = known ? (balance - floor - listed > 0n ? balance - floor - listed : 0n) : null;

  return (
    <Card title="Cash you can spare" aside={<Tag>on-chain</Tag>}>
      <dl className="kv">
        <div><dt>USDC balance</dt><dd>{balance === null ? "unavailable" : <Money minor={balance} />} <Tag>on-chain</Tag></dd></div>
        <div>
          <dt><Term tip="Cash your agent keeps untouched. It is your agent's private setting and is read from your own agent on this machine.">Reserve</Term></dt>
          <dd>{floor === "loading" ? "…" : floor === null ? "unavailable" : <Money minor={floor} />} <Tag>policy</Tag></dd>
        </div>
        <div><dt>Payments you listed</dt><dd><Money minor={listed} /> <Tag>declared</Tag></dd></div>
        <div><dt>Cash you can spare</dt><dd>{spare === null ? "unavailable" : <Money minor={spare} accent />}</dd></div>
      </dl>
      <p className="muted tiny">
        {floor === null
          ? "Your buyer agent is not running, so your reserve cannot be read. Nothing is assumed."
          : "Balance less reserve less the payments you listed. A payment you list yourself is only as reliable as your list, so it is marked declared."}
        {source === "browser" && obligations.length > 0 ? " Your list is saved only on this device." : ""}
      </p>
    </Card>
  );
}

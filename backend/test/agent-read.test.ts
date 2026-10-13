import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { agentReadTypedData, domain } from "../src/shared";
import { makeApp } from "./helpers";

const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const buyerAgent = privateKeyToAccount(("0x" + "44".repeat(32)) as `0x${string}`);
const otherAgent = privateKeyToAccount(("0x" + "55".repeat(32)) as `0x${string}`);
const stranger = privateKeyToAccount(("0x" + "66".repeat(32)) as `0x${string}`);
const PATH = "/api/agent/obligations";

async function setup() {
  const made = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, AGENT_WALLETS: `${buyerAgent.address},${otherAgent.address}` } });
  const org = async (name: string, wallet?: string) => {
    const r = await made.db.query<{ id: string }>("insert into organizations (name, role) values ($1, 'buyer') returning id", [name]);
    if (wallet) await made.db.query("insert into wallets (org_id, address, purpose, mode) values ($1, $2, 'agent', 'agent')", [r[0]!.id, wallet.toLowerCase()]);
    return r[0]!.id;
  };
  return { ...made, org };
}

async function signed(account: typeof buyerAgent, o: { resource?: string; ts?: number; as?: string } = {}) {
  const ts = o.ts ?? Math.floor(Date.now() / 1000);
  const signature = await account.signTypedData(agentReadTypedData(D, { resource: o.resource ?? PATH, ts }) as never);
  return { "x-agent-wallet": o.as ?? account.address, "x-agent-ts": String(ts), "x-agent-sig": signature };
}

describe("signed agent read of the buyer's payment calendar", () => {
  it("returns only that agent's own obligations, labelled declared", async () => {
    const { app, db, org } = await setup();
    const mine = await org("Buyer A", buyerAgent.address);
    const theirs = await org("Buyer B", otherAgent.address);
    await db.query("insert into obligations (buyer_org, label, amount, due_date, kind) values ($1, 'payroll', 3000, '2026-11-01T00:00:00Z', 'payroll'), ($2, 'rent', 999, '2026-11-02T00:00:00Z', 'bill')", [mine, theirs]);
    const res = await app.request(PATH, { headers: await signed(buyerAgent) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Array<{ amount: string; dueSec: number; kind: string; provenance: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ amount: "3000000000", kind: "payroll", provenance: "declared", dueSec: Date.parse("2026-11-01T00:00:00Z") / 1000 });
    // the label is the owner's free text: it is not sent to an agent
    expect(Object.keys(body.data[0]!)).not.toContain("label");
  });

  it("an empty calendar is an empty list, not an error", async () => {
    const { app, org } = await setup();
    await org("Buyer A", buyerAgent.address);
    const res = await app.request(PATH, { headers: await signed(buyerAgent) });
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it("refuses a wallet that is not a configured agent", async () => {
    const { app } = await setup();
    expect((await app.request(PATH, { headers: await signed(stranger) })).status).toBe(403);
  });

  it("refuses a signature made by someone else, for another path, or too old", async () => {
    const { app, org } = await setup();
    await org("Buyer A", buyerAgent.address);
    // signed by the stranger but claiming to be the agent
    expect((await app.request(PATH, { headers: await signed(stranger, { as: buyerAgent.address }) })).status).toBe(401);
    // signed for a different resource: cannot be replayed on this route
    expect((await app.request(PATH, { headers: await signed(buyerAgent, { resource: "/api/agent/other" }) })).status).toBe(401);
    // two minutes old
    expect((await app.request(PATH, { headers: await signed(buyerAgent, { ts: Math.floor(Date.now() / 1000) - 600 }) })).status).toBe(401);
    // no headers at all
    expect((await app.request(PATH)).status).toBe(403);
  });

  it("refuses an agent that is not linked to a business", async () => {
    const { app } = await setup();
    expect((await app.request(PATH, { headers: await signed(buyerAgent) })).status).toBe(403);
  });

  it("is off until the agent wallets are configured", async () => {
    const { app } = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK } });
    expect((await app.request(PATH, { headers: await signed(buyerAgent) })).status).toBe(503);
  });
});

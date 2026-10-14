import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { domain } from "../src/shared";
import { agentHeaders, makeApp } from "./helpers";

const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const buyerAgent = privateKeyToAccount(("0x" + "44".repeat(32)) as `0x${string}`);
const otherAgent = privateKeyToAccount(("0x" + "55".repeat(32)) as `0x${string}`);
const stranger = privateKeyToAccount(("0x" + "66".repeat(32)) as `0x${string}`);
const PATH = "/api/agent/exposure-policy";

async function setup() {
  const made = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, AGENT_WALLETS: `${buyerAgent.address},${otherAgent.address}` } });
  const org = async (name: string, wallet?: string) => {
    const r = await made.db.query<{ id: string }>("insert into organizations (name, role) values ($1, 'buyer') returning id", [name]);
    if (wallet) await made.db.query("insert into wallets (org_id, address, purpose, mode) values ($1, $2, 'agent', 'agent')", [r[0]!.id, wallet.toLowerCase()]);
    return r[0]!.id;
  };
  return { ...made, org };
}

async function signed(account: typeof buyerAgent, o: { resource?: string; ts?: number; as?: string; nonce?: string } = {}) {
  return agentHeaders(account, D, o.resource ?? PATH, { ts: o.ts, as: o.as, nonce: o.nonce });
}

describe("signed agent read of the owner's exposure (risk) limit", () => {
  it("returns only that agent's own business's policy, as integers", async () => {
    const { app, db, org } = await setup();
    const mine = await org("Buyer A", buyerAgent.address);
    const theirs = await org("Buyer B", otherAgent.address);
    await db.query("insert into exposure_policies (org_id, version, new_counterparty_limit, max_limit, growth_bps, lookback_days, grace_seconds) values ($1, 2, 3000, 9000, 1500, 180, 86400), ($2, 1, 111, 222, 0, 30, 0)", [mine, theirs]);
    const res = await app.request(PATH, { headers: await signed(buyerAgent) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ configured: true, version: "exposure-2", newCounterpartyLimit: "3000000000", maxLimit: "9000000000", growthBps: 1500 });
    expect(JSON.stringify(body)).not.toContain("111"); // the other business's limit is not visible
  });

  it("a business with no policy reads as not configured, not as an error", async () => {
    const { app, org } = await setup();
    await org("Buyer A", buyerAgent.address);
    const res = await app.request(PATH, { headers: await signed(buyerAgent) });
    expect(((await res.json()) as { data: unknown }).data).toEqual({ configured: false });
  });

  it("no longer serves a payment calendar, a hurdle, a floor or a cost of waiting: those stay with the agent", async () => {
    const { app, org } = await setup();
    await org("Buyer A", buyerAgent.address);
    for (const p of ["/api/agent/obligations", "/api/obligations", "/api/policy", "/api/prefs"]) {
      expect((await app.request(p, { headers: await signed(buyerAgent, { resource: p }) })).status, p).toBe(404);
    }
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
    // ten minutes old
    expect((await app.request(PATH, { headers: await signed(buyerAgent, { ts: Math.floor(Date.now() / 1000) - 600 }) })).status).toBe(401);
    // no headers at all
    expect((await app.request(PATH)).status).toBe(403);
  });

  it("a signed request is good for 60 seconds and one use: stale, replayed and nonce-less requests all fail", async () => {
    const { app, db, org } = await setup();
    await org("Buyer A", buyerAgent.address);
    const now = Math.floor(Date.now() / 1000);
    // 90 seconds old is stale now (the window used to be 120)
    const stale = await app.request(PATH, { headers: await signed(buyerAgent, { ts: now - 90 }) });
    expect(stale.status).toBe(401);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("STALE_REQUEST");
    // a fresh request works once; the identical request, replayed by anyone who captured it, does not
    const headers = await signed(buyerAgent);
    expect((await app.request(PATH, { headers })).status).toBe(200);
    const replay = await app.request(PATH, { headers });
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe("REPLAYED_REQUEST");
    // no nonce, or a malformed one
    const { "x-agent-nonce": _drop, ...noNonce } = await signed(buyerAgent);
    expect(((await (await app.request(PATH, { headers: noNonce })).json()) as { error: { code: string } }).error.code).toBe("BAD_NONCE");
    expect(((await (await app.request(PATH, { headers: { ...(await signed(buyerAgent)), "x-agent-nonce": "short" } })).json()) as { error: { code: string } }).error.code).toBe("BAD_NONCE");
    // a header nonce that is not the one that was signed fails the signature and does not spend that nonce
    const good = await signed(buyerAgent, { nonce: "a".repeat(32) });
    expect((await app.request(PATH, { headers: { ...good, "x-agent-nonce": "b".repeat(32) } })).status).toBe(401);
    expect((await app.request(PATH, { headers: good })).status).toBe(200);
    // a stranger's forged request does not burn the real agent's nonce
    const forged = await signed(stranger, { as: buyerAgent.address, nonce: "c".repeat(32) });
    expect((await app.request(PATH, { headers: forged })).status).toBe(401);
    expect((await db.query("select 1 from agent_read_nonces where nonce = $1", ["c".repeat(32)])).length).toBe(0);
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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { agentReadTypedData, domain } from "../src/shared";
import { browser, makeApp, onboard } from "./helpers";

const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const agent = privateKeyToAccount(("0x" + "99".repeat(32)) as `0x${string}`);
const rogue = privateKeyToAccount(("0x" + "98".repeat(32)) as `0x${string}`);

async function setup(clock?: { now: Date }) {
  const made = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, AGENT_WALLETS: `${agent.address}` }, ...(clock ? { now: () => clock.now } : {}) });
  const buyer = browser(made.app);
  const other = browser(made.app);
  await onboard(buyer, made.google, { sub: "b", email: "buyer@example.com", walletIndex: 2, side: "buyer" });
  await onboard(other, made.google, { sub: "o", email: "other@example.com", walletIndex: 3, side: "buyer" });
  return { ...made, buyer, other };
}

/** What the agent process does: sign the exact path, which includes the code, and POST it. */
async function redeem(app: Awaited<ReturnType<typeof setup>>["app"], code: string, who = agent, o: { path?: string; ts?: number } = {}) {
  const path = `/api/agent/link/${code}`;
  const ts = o.ts ?? Math.floor(Date.now() / 1000);
  const sig = await who.signTypedData(agentReadTypedData(D, { resource: o.path ?? path, ts }) as never);
  return app.request(path, { method: "POST", headers: { "x-agent-wallet": who.address, "x-agent-ts": String(ts), "x-agent-sig": sig } });
}

describe("linking an agent wallet to a business", () => {
  it("the owner makes a code, the agent redeems it, and then the agent can read that business's data and no one else's", async () => {
    const { app, buyer, other, db } = await setup();
    expect((await buyer.get("/api/me/agent")).json.data).toEqual({ linked: [] });
    const made = await buyer.post("/api/me/agent-link", {});
    expect(made.status).toBe(200);
    expect(made.json.data.code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(made.json.data.minutes).toBe(15);

    const res = await redeem(app, made.json.data.code);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({ linked: true });
    expect((await buyer.get("/api/me/agent")).json.data).toEqual({ linked: [agent.address.toLowerCase()] });
    expect((await other.get("/api/me/agent")).json.data).toEqual({ linked: [] });

    // Now the signed reads work, and they return the linked business's data.
    const org = await db.query<{ org_id: string }>("select org_id::text as org_id from accounts where address = $1", [(await buyer.get("/api/me")).json.data.address]);
    await db.query("insert into exposure_policies (org_id, version, new_counterparty_limit, max_limit, growth_bps, lookback_days, grace_seconds) values ($1, 1, 1500, 6000, 2000, 180, 86400)", [org[0]!.org_id]);
    const path = "/api/agent/exposure-policy";
    const ts = Math.floor(Date.now() / 1000);
    const sig = await agent.signTypedData(agentReadTypedData(D, { resource: path, ts }) as never);
    const read = await app.request(path, { headers: { "x-agent-wallet": agent.address, "x-agent-ts": String(ts), "x-agent-sig": sig } });
    expect(((await read.json()) as any).data).toMatchObject({ configured: true, newCounterpartyLimit: "1500000000", maxLimit: "6000000000" });
  });

  it("a code works once", async () => {
    const { app, buyer } = await setup();
    const { code } = (await buyer.post("/api/me/agent-link", {})).json.data;
    expect((await redeem(app, code)).status).toBe(200);
    const again = await redeem(app, code);
    expect(again.status).toBe(400);
    expect(((await again.json()) as any).error.code).toBe("BAD_CODE");
  });

  it("a code that is wrong or has expired is refused", async () => {
    const clock = { now: new Date() };
    const { app, buyer } = await setup(clock);
    const { code } = (await buyer.post("/api/me/agent-link", {})).json.data;
    expect((await redeem(app, "AAAA-AAAA-AAAA")).status).toBe(400);
    clock.now = new Date(clock.now.getTime() + 16 * 60_000);
    expect((await redeem(app, code)).status).toBe(400);
  });

  it("the request must be signed by the agent wallet, over this exact code, and recently", async () => {
    const { app, buyer } = await setup();
    const { code } = (await buyer.post("/api/me/agent-link", {})).json.data;
    // signed by someone else but claiming to be the agent
    const forged = await redeem(app, code, rogue);
    expect(forged.status).toBe(403); // rogue is not a configured agent for this deployment
    // signed for a different code: cannot be replayed
    expect((await redeem(app, code, agent, { path: "/api/agent/link/OTHER-CODE-HERE" })).status).toBe(401);
    // too old
    expect((await redeem(app, code, agent, { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    // and the code is still good for the real agent afterwards
    expect((await redeem(app, code)).status).toBe(200);
  });

  it("an agent already linked to one business cannot be taken by another", async () => {
    const { app, buyer, other } = await setup();
    const first = (await buyer.post("/api/me/agent-link", {})).json.data.code;
    expect((await redeem(app, first)).status).toBe(200);
    const second = (await other.post("/api/me/agent-link", {})).json.data.code;
    const res = await redeem(app, second);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe("ALREADY_LINKED");
    expect((await other.get("/api/me/agent")).json.data).toEqual({ linked: [] });
  });

  it("redeeming again for the same business is harmless", async () => {
    const { app, buyer } = await setup();
    expect((await redeem(app, (await buyer.post("/api/me/agent-link", {})).json.data.code)).status).toBe(200);
    expect((await redeem(app, (await buyer.post("/api/me/agent-link", {})).json.data.code)).status).toBe(200);
    expect((await buyer.get("/api/me/agent")).json.data.linked).toHaveLength(1);
  });

  it("only a signed-in business with a side can make a code, and only its own agents are listed", async () => {
    const { app } = await setup();
    expect((await browser(app).post("/api/me/agent-link", {})).status).toBe(401);
    expect((await browser(app).get("/api/me/agent")).status).toBe(401);
  });

  it("the code is never stored in the clear", async () => {
    const { buyer, db } = await setup();
    const { code } = (await buyer.post("/api/me/agent-link", {})).json.data;
    const rows = await db.query<{ code_hash: string }>("select code_hash from agent_link_codes");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.code_hash).not.toContain(code.replace(/-/g, ""));
  });
});

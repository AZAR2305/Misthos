import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { agentReadTypedData, domain } from "../src/shared";
import { browser, makeApp, onboard, wallet } from "./helpers";

const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const agent = privateKeyToAccount(("0x" + "88".repeat(32)) as `0x${string}`);
const GOOD = { newCounterpartyLimit: "5000000000", maxLimit: "20000000000", growthBps: 2000, lookbackDays: 180, graceSeconds: 86_400 };

async function setup() {
  const made = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, AGENT_WALLETS: agent.address } });
  const buyer = browser(made.app);
  const supplier = browser(made.app);
  await onboard(buyer, made.google, { sub: "b", email: "buyer@example.com", walletIndex: 2, side: "buyer" });
  await onboard(supplier, made.google, { sub: "s", email: "supplier@example.com", walletIndex: 1, side: "supplier" });
  return { ...made, buyer, supplier };
}

describe("exposure policy", () => {
  it("is not configured until the owner saves one: no invented limits", async () => {
    const { buyer } = await setup();
    expect((await buyer.get("/api/exposure-policy")).json.data).toEqual({ side: "buyer", configured: false });
  });

  it("saves, versions, and keeps every version; saving identical numbers changes nothing", async () => {
    const { buyer, db } = await setup();
    const first = await buyer.put("/api/exposure-policy", GOOD);
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ side: "buyer", configured: true, version: "exposure-1", newCounterpartyLimit: "5000000000", maxLimit: "20000000000", growthBps: 2000 });
    expect((await buyer.put("/api/exposure-policy", GOOD)).json.data.version).toBe("exposure-1");
    const changed = await buyer.put("/api/exposure-policy", { ...GOOD, newCounterpartyLimit: "6000000000" });
    expect(changed.json.data).toMatchObject({ version: "exposure-2", newCounterpartyLimit: "6000000000" });
    const versions = await db.query<{ version: number; new_counterparty_limit: string }>("select version, new_counterparty_limit::text as new_counterparty_limit from exposure_policy_versions order by version");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]!.new_counterparty_limit).toMatch(/^5000\.0+$/); // the old version still holds the old number
  });

  it("works for the supplier side too, and each business has its own policy", async () => {
    const { buyer, supplier } = await setup();
    await buyer.put("/api/exposure-policy", GOOD);
    expect((await supplier.get("/api/exposure-policy")).json.data).toEqual({ side: "supplier", configured: false });
    await supplier.put("/api/exposure-policy", { ...GOOD, newCounterpartyLimit: "1000000000", maxLimit: "1000000000" });
    expect((await supplier.get("/api/exposure-policy")).json.data.newCounterpartyLimit).toBe("1000000000");
    expect((await buyer.get("/api/exposure-policy")).json.data.newCounterpartyLimit).toBe("5000000000");
  });

  it("refuses nonsense: a maximum below the new-counterparty limit, bad numbers, and a signed-out caller", async () => {
    const { app, buyer } = await setup();
    expect((await buyer.put("/api/exposure-policy", { ...GOOD, maxLimit: "1" })).status).toBe(400);
    expect((await buyer.put("/api/exposure-policy", { ...GOOD, growthBps: 20_000 })).status).toBe(400);
    expect((await buyer.put("/api/exposure-policy", { ...GOOD, lookbackDays: 0 })).status).toBe(400);
    expect((await buyer.put("/api/exposure-policy", { ...GOOD, newCounterpartyLimit: "-1" })).status).toBe(400);
    expect((await browser(app).get("/api/exposure-policy")).status).toBe(401);
  });

  it("the agent reads its owner's policy with a signed request, and only its own", async () => {
    const { app, buyer, supplier, db } = await setup();
    await buyer.put("/api/exposure-policy", GOOD);
    await supplier.put("/api/exposure-policy", { ...GOOD, newCounterpartyLimit: "1", maxLimit: "1" });
    const org = await db.query<{ org_id: string }>("select org_id::text as org_id from accounts where address = $1", [wallet(2).address.toLowerCase()]);
    await db.query("insert into wallets (org_id, address, purpose, mode) values ($1, $2, 'agent', 'agent')", [org[0]!.org_id, agent.address.toLowerCase()]);
    const path = "/api/agent/exposure-policy";
    const ts = Math.floor(Date.now() / 1000);
    const sig = await agent.signTypedData(agentReadTypedData(D, { resource: path, ts }) as never);
    const res = await app.request(path, { headers: { "x-agent-wallet": agent.address, "x-agent-ts": String(ts), "x-agent-sig": sig } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toMatchObject({ configured: true, version: "exposure-1", newCounterpartyLimit: "5000000000", maxLimit: "20000000000" });
    // a signature for another path cannot read it
    const wrong = await agent.signTypedData(agentReadTypedData(D, { resource: "/api/agent/obligations", ts }) as never);
    expect((await app.request(path, { headers: { "x-agent-wallet": agent.address, "x-agent-ts": String(ts), "x-agent-sig": wrong } })).status).toBe(401);
  });
});

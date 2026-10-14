/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GENESIS_HASH, decisionTypedData, domain, hashDecision } from "../src/shared";
import { makeApp } from "./helpers";

const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const agent = privateKeyToAccount(("0x" + "22".repeat(32)) as `0x${string}`);

/** One signed first entry with the snapshot and proposal given, the way an agent process would send it. */
async function entry(snapshot: unknown, proposal: unknown = null) {
  const e = { prevHash: GENESIS_HASH, actor: "buyer_agent" as const, snapshot, proposal, outcome: "rejected" as const, reason: "LIQUIDITY_FLOOR: test" };
  const hash = hashDecision(e);
  const signature = await agent.signTypedData(decisionTypedData(D, { hash, prevHash: GENESIS_HASH, actor: e.actor, seq: 0 }) as never);
  return { seq: 0, prevHash: GENESIS_HASH, hash, actor: e.actor, invoiceRef: "0x" + "ab".repeat(32), reasonCode: "LIQUIDITY_FLOOR", at: 1_800_000_000, snapshot, proposal, outcome: e.outcome, reason: e.reason, signer: agent.address, signature };
}

const setup = () => makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, AGENT_WALLETS: agent.address } });
const post = (app: Awaited<ReturnType<typeof setup>>["app"], entries: unknown[]) =>
  app.request("/api/log/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries }) });

describe("the public log carries the policy version and result, and refuses private values", () => {
  it("returns the policy version and the result as top-level fields, from the snapshot", async () => {
    const { app } = await setup();
    const snapshot = { invoiceId: "0x" + "ab".repeat(32), rung: 1, rateBps: 800, policyVersion: "buyer-policy-3", policyCommitment: "0x" + "cc".repeat(32), inputsCommitment: "0x" + "dd".repeat(32), result: { code: "LIQUIDITY_FLOOR" } };
    expect((await post(app, [await entry(snapshot)])).status).toBe(201);
    const item = (await (await app.request("/api/log")).json() as any).data.items[0];
    expect(item).toMatchObject({ policyVersion: "buyer-policy-3", result: "LIQUIDITY_FLOOR" });
    expect(item.snapshot.inputsCommitment).toBe("0x" + "dd".repeat(32));
  });

  it("an entry from before the policy stamp has no version rather than an invented one", async () => {
    const { app } = await setup();
    await post(app, [await entry({ invoiceId: "0x" + "ab".repeat(32), rung: 0 })]);
    const item = (await (await app.request("/api/log")).json() as any).data.items[0];
    expect(item.policyVersion).toBeNull();
    expect(item.result).toBeNull();
  });

  it("refuses a snapshot that contains a private policy value, however deep", async () => {
    const { app } = await setup();
    for (const snapshot of [
      { invoiceId: "x", prefs: { costOfWaitingAprBps: 2200 } },
      { invoiceId: "x", nested: [{ deeper: { hurdleAprBps: 700 } }] },
      { invoiceId: "x", liquidityFloor: "5000000000" },
    ]) {
      const res = await post(app, [await entry(snapshot)]);
      expect(res.status).toBe(422);
      expect(((await res.json()) as any).error.code).toBe("PRIVATE_VALUE");
    }
  });

  it("refuses a proposal that contains a private policy value, and stores nothing", async () => {
    const { app } = await setup();
    const res = await post(app, [await entry({ invoiceId: "x" }, { maxRateBps: 1234 })]);
    expect(res.status).toBe(422);
    expect((await (await app.request("/api/log")).json() as any).data.total).toBe(0);
  });
});

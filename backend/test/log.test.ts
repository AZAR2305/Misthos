/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GENESIS_HASH, decisionTypedData, domain, hashDecision } from "../src/shared";
import { makeApp, ORIGIN } from "./helpers";

const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const agent = privateKeyToAccount(("0x" + "22".repeat(32)) as `0x${string}`);
const stranger = privateKeyToAccount(("0x" + "33".repeat(32)) as `0x${string}`);

/** Builds a chain the way an agent process does: hash each entry onto the last and sign it with the wallet. */
async function chain(n: number, who = agent) {
  const out: Record<string, unknown>[] = [];
  let prev: `0x${string}` = GENESIS_HASH;
  for (let seq = 0; seq < n; seq++) {
    const e = { prevHash: prev, actor: "buyer_agent" as const, snapshot: { invoiceId: "0x" + "ab".repeat(32), seq }, proposal: null, outcome: "auto_apply" as const, reason: `decision ${seq}` };
    const hash = hashDecision(e);
    const signature = await who.signTypedData(decisionTypedData(D, { hash, prevHash: prev, actor: e.actor, seq }) as never);
    out.push({ seq, prevHash: prev, hash, actor: e.actor, invoiceRef: "0x" + "ab".repeat(32), at: 1_800_000_000 + seq, snapshot: e.snapshot, proposal: null, outcome: e.outcome, reason: e.reason, signer: who.address, signature });
    prev = hash;
  }
  return out;
}

const setup = () => makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, AGENT_WALLETS: agent.address } });
const post = (app: Awaited<ReturnType<typeof setup>>["app"], entries: unknown[]) =>
  app.request("/api/log/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries }) });

describe("signed decision log", () => {
  it("is off until the agent wallets are configured", async () => {
    const { app } = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK } });
    expect((await post(app, await chain(1))).status).toBe(503);
  });

  it("stores a signed chain, answers delivery twice with the same result, and verifies", async () => {
    const { app } = await setup();
    const entries = await chain(3);
    const first = await post(app, entries);
    expect(first.status).toBe(201);
    expect((await first.json() as any).data).toEqual({ received: 3, stored: 3 });
    expect((await (await post(app, entries)).json() as any).data).toEqual({ received: 3, stored: 0 }); // a retried delivery stores nothing new
    const v = (await (await app.request("/api/log/verify")).json() as any).data;
    expect(v).toMatchObject({ ok: true, count: 3, agents: [{ signer: agent.address.toLowerCase(), count: 3, chainOk: true, signaturesOk: true, ok: true }] });
    const list = (await (await app.request("/api/log")).json() as any).data;
    expect(list.total).toBe(3);
    expect(list.items[0]).toMatchObject({ seq: 2, outcome: "auto_apply", settlement: null });
  });

  it("refuses an unknown agent, a wrong signature and an entry whose hash is not its content", async () => {
    const { app } = await setup();
    expect((await post(app, await chain(1, stranger))).status).toBe(403);
    const forged = (await chain(1))[0]!;
    forged.signature = (await chain(1, stranger))[0]!.signature;
    expect((await post(app, [forged])).status).toBe(422);
    const edited = (await chain(1))[0]!;
    edited.reason = "decision, but edited";
    const res = await post(app, [edited]);
    expect(res.status).toBe(422);
    expect((await res.json() as any).error.code).toBe("BAD_HASH");
  });

  it("refuses a gap and a fork", async () => {
    const { app } = await setup();
    const c = await chain(3);
    expect((await post(app, [c[1]!])).status).toBe(409); // entry 1 before entry 0
    expect((await post(app, [c[0]!])).status).toBe(201);
    const other = (await chain(1)).map((e) => ({ ...e }));
    const fork: any = { ...other[0]!, reason: "a different first decision" };
    const e = { prevHash: GENESIS_HASH, actor: "buyer_agent" as const, snapshot: fork.snapshot, proposal: null, outcome: "auto_apply" as const, reason: fork.reason as string };
    const hash = hashDecision(e);
    fork.hash = hash;
    fork.signature = await agent.signTypedData(decisionTypedData(D, { hash, prevHash: GENESIS_HASH, actor: e.actor, seq: 0 }) as never);
    const res = await post(app, [fork]);
    expect(res.status).toBe(409);
    expect((await res.json() as any).error.code).toBe("LOG_FORK");
  });

  it("verify notices a stored row that was changed afterwards", async () => {
    const { app, db } = await setup();
    await post(app, await chain(3));
    await db.query("update decisions set reason = 'rewritten' where seq = 1");
    const v = (await (await app.request("/api/log/verify")).json() as any).data;
    expect(v.ok).toBe(false);
    expect(v.agents[0]).toMatchObject({ chainOk: false, ok: false });
  });

  it("links an entry to the settlement transaction that carries its hash", async () => {
    const { app, db } = await setup();
    const c = await chain(2);
    await post(app, c);
    await db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, 0, 10, 'EarlySettled', $2::jsonb)", ["0x" + "cd".repeat(32), JSON.stringify({ id: "0x" + "ab".repeat(32), decisionHash: c[1]!.hash })]);
    const items = (await (await app.request("/api/log")).json() as any).data.items as Array<{ seq: number; settlement: { txHash: string } | null }>;
    expect(items.find((i) => i.seq === 1)!.settlement?.txHash).toBe("0x" + "cd".repeat(32));
    expect(items.find((i) => i.seq === 0)!.settlement).toBeNull();
  });
});
void ORIGIN;

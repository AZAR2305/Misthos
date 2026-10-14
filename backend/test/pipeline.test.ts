/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  BuyerAgent,
  SupplierAgent,
  fetchExposureEvents,
  fetchExposurePolicy,
  fetchObligations,
  fetchPayables,
  openDecisionStore,
  signedReader,
  type AgentModel,
  type ChainReader,
  type FetchLike,
  type OnChainInvoice,
} from "../../agent/src/agents/index";
import { auditFromFiles } from "../../agent/src/audit";
import { domain, findPrivateKey, type BuyerPolicy, type SupplierPrefs } from "../../agent/src/core/index";
import { messageSchema, type OfferMsg } from "../../agent/src/protocol/index";
import { eoaVerifier, type WalletAdapter } from "../../agent/src/wallets/types";
import { buildTrace, fromApiEntry, type LogEntry } from "../../frontend/src/lib/trace";
import { makeApp } from "./helpers";

/**
 * The whole data path, with the real code on both ends and nothing faked but the chain RPC and the model: a buyer agent signs a
 * read of its payment calendar and credit limits from the real API, gets its history from indexed chain events, decides,
 * signs, and pushes its log to the API; the supplier does the same; the API's public log verifies, and the trace builder the
 * page uses reads it. (Wallets are key-backed stand-ins for the Circle login, as in the agent tests.)
 */
const USD = 1_000_000n;
const DAY = 86_400;
const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const D = domain(5042002, BOOK);
const INVOICE = ("0x" + "42".repeat(32)) as `0x${string}`;
const buyerKey = privateKeyToAccount(("0x" + "b1".repeat(32)) as `0x${string}`);
const supplierKey = privateKeyToAccount(("0x" + "a1".repeat(32)) as `0x${string}`);
const TOKEN = "0x3600000000000000000000000000000000000000";

const keyWallet = (account: typeof buyerKey): WalletAdapter & { calls: any[] } => {
  const calls: any[] = [];
  return {
    mode: "agent",
    address: async () => account.address,
    balance: async () => 0n,
    signTypedData: (p) => account.signTypedData(p as never),
    execute: async (call) => {
      calls.push(call);
      return { txHash: ("0x" + "ab".repeat(32)) as `0x${string}`, raw: {} };
    },
    health: async () => ({ ok: true }),
    calls,
  } as WalletAdapter & { calls: any[] };
};

const model: AgentModel = { propose: async ({ schema }: any) => schema.parse({ action: "accelerate_now", reason: "x", evidence_refs: ["invoice"] }) };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function scenario(o: { newCounterpartyLimit: bigint; maxLimit: bigint; history: boolean; obligation?: bigint; payable?: bigint; pastRates?: number[] }) {
  const { app, db } = await makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, AGENT_WALLETS: `${buyerKey.address},${supplierKey.address}` } });
  const now = Math.floor(Date.now() / 1000);

  // The buyer's business, its agent wallet, its declared payment and its credit limit, as the owner saved them.
  const org = (await db.query<{ id: string }>("insert into organizations (name, role) values ('Buyer Co', 'buyer') returning id"))[0]!.id;
  await db.query("insert into wallets (org_id, address, purpose, mode) values ($1, $2, 'agent', 'agent')", [org, buyerKey.address.toLowerCase()]);
  if (o.obligation) await db.query("insert into obligations (buyer_org, label, amount, due_date, kind) values ($1, 'Payroll', $2, $3, 'payroll')", [org, o.obligation.toString().replace(/(\d{6})$/, ".$1"), new Date((now + 20 * DAY) * 1000).toISOString()]);
  await db.query("insert into exposure_policies (org_id, version, new_counterparty_limit, max_limit, growth_bps, lookback_days, grace_seconds) values ($1, 3, $2, $3, 2000, 180, 86400)", [org, (o.newCounterpartyLimit).toString().replace(/(\d{6})$/, ".$1"), o.maxLimit.toString().replace(/(\d{6})$/, ".$1")]);

  // The supplier's own business, agent wallet and credit limit (it reads them the same way the buyer does).
  const supOrg = (await db.query<{ id: string }>("insert into organizations (name, role) values ('Supplier Co', 'supplier') returning id"))[0]!.id;
  await db.query("insert into wallets (org_id, address, purpose, mode) values ($1, $2, 'agent', 'agent')", [supOrg, supplierKey.address.toLowerCase()]);
  await db.query("insert into exposure_policies (org_id, version, new_counterparty_limit, max_limit, growth_bps, lookback_days, grace_seconds) values ($1, 1, 1000, 100000, 2000, 180, 86400)", [supOrg]);

  const raw = (tx: string, block: number, name: string, payload: object) => db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, 5, $2, $3, $4::jsonb)", [tx, block, name, JSON.stringify(payload)]);
  // Something else the chain says this buyer owes: an approved invoice from another supplier. It is a verified obligation.
  if (o.payable) {
    const other = "0x" + "66".repeat(32);
    await raw("0x" + "d1".repeat(32), 20, "InvoiceRegistered", { id: other, supplier: "0x" + "dd".repeat(20), buyer: buyerKey.address.toLowerCase(), token: TOKEN, amount: o.payable.toString(), dueDate: String(now + 40 * DAY), refHash: "0x" + "98".repeat(32) });
    await raw("0x" + "d2".repeat(32), 21, "InvoiceApproved", { id: other, approvedAt: String(now) });
  }
  // Early payments this buyer made to this supplier before, at known rates: where the supplier's ladder should start.
  for (const [i, rate] of (o.pastRates ?? []).entries()) {
    const past = "0x" + (0x80 + i).toString(16).repeat(32);
    await raw("0x" + (0xa0 + i).toString(16).repeat(32), 30 + i * 3, "InvoiceRegistered", { id: past, supplier: supplierKey.address.toLowerCase(), buyer: buyerKey.address.toLowerCase(), token: TOKEN, amount: "1000000000", dueDate: String(now + 5 * DAY), refHash: "0x" + "97".repeat(32) });
    await raw("0x" + (0xb0 + i).toString(16).repeat(32), 31 + i * 3, "InvoiceApproved", { id: past, approvedAt: String(now - 20 * DAY) });
    await raw("0x" + (0xc0 + i).toString(16).repeat(32), 32 + i * 3, "EarlySettled", { id: past, net: "990000000", discount: "10000000", rateBps: rate, fee: "1000000", decisionHash: "0x" + "96".repeat(32) });
    await db.query("insert into chain_blocks (block, time_sec) values ($1, $2)", [32 + i * 3, now - (10 + i) * DAY]);
  }

  // History the indexer read from the chain: one invoice between these two businesses, settled on its due date 10 days ago.
  if (o.history) {
    const ev = (tx: string, block: number, name: string, payload: object) => db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ($1, 4, $2, $3, $4::jsonb)", [tx, block, name, JSON.stringify(payload)]);
    const old = "0x" + "77".repeat(32);
    await ev("0x" + "e1".repeat(32), 1, "InvoiceRegistered", { id: old, supplier: supplierKey.address.toLowerCase(), buyer: buyerKey.address.toLowerCase(), token: TOKEN, amount: "10000000000", dueDate: String(now - 10 * DAY), refHash: "0x" + "99".repeat(32) });
    await ev("0x" + "e2".repeat(32), 2, "InvoiceApproved", { id: old, approvedAt: String(now - 60 * DAY) });
    await ev("0x" + "e3".repeat(32), 3, "SettledOnDue", { id: old, amount: "10000000000" });
    await db.query("insert into chain_blocks (block, time_sec) values (3, $1)", [now - 10 * DAY]);
  }

  // Everything an agent sends to the API goes through this: the real app, in this process.
  const appFetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const res = await app.request(u.pathname + u.search, { method: init?.method, headers: init?.headers, body: init?.body });
    return { ok: res.ok, status: res.status, json: () => res.json() };
  };

  const dir = mkdtempSync(join(tmpdir(), "misthos-pipeline-"));
  dirs.push(dir);
  const buyerWallet = keyWallet(buyerKey);
  const supplierWallet = keyWallet(supplierKey);
  const buyerPolicy: BuyerPolicy = { hurdleAprBps: 0, liquidityFloor: 5_000n * USD, perInvoiceCap: 0n, dailyCap: 0n, humanAbove: 0n, feeBps: 1000 };
  const prefs: SupplierPrefs = { costOfWaitingAprBps: 2200, maxRateBps: 1000, startRateBps: 0, stepBps: 200 };
  const buyerStore = openDecisionStore({ name: "buyer", dataDir: dir, wallet: buyerWallet, domain: D, backendUrl: "http://api.test", policy: { label: "buyer-policy", params: buyerPolicy }, fetch: appFetch });
  const supplierStore = openDecisionStore({ name: "supplier", dataDir: dir, wallet: supplierWallet, domain: D, backendUrl: "http://api.test", policy: { label: "supplier-policy", params: prefs }, fetch: appFetch });

  const reader = signedReader({ backendUrl: "http://api.test", wallet: buyerWallet, domain: D, fetch: appFetch });
  const invoice: OnChainInvoice = { supplier: supplierKey.address, buyer: buyerKey.address, token: TOKEN, amount: 2_000n * USD, dueDate: BigInt(now + 27 * DAY), approvedAt: BigInt(now), status: "approved" };
  const chain: ChainReader = { invoice: async (id) => (id === INVOICE ? invoice : undefined), offerNonceUsed: async () => false };

  const buyer = new BuyerAgent({
    wallet: buyerWallet,
    domain: D,
    model: model as AgentModel,
    policy: buyerPolicy,
    store: buyerStore,
    chain,
    invoiceBook: BOOK,
    verifier: eoaVerifier,
    // The real calendar from the API, and a real balance far above any floor: the only things that can stop this buyer are its calendar and its credit limit.
    treasury: async () => ({ cash: 100_000n * USD, obligations: [...(await fetchObligations(reader)), ...(await fetchPayables({ backendUrl: "http://api.test", buyer: buyerKey.address, fetch: appFetch }))] }),
    exposure: {
      policy: () => fetchExposurePolicy(reader),
      events: (supplier) => fetchExposureEvents({ backendUrl: "http://api.test", side: "buyer", owner: buyerKey.address, counterparty: supplier, fetch: appFetch }),
    },
  });
  const supplier = new SupplierAgent({
    wallet: supplierWallet,
    domain: D,
    model,
    prefs,
    store: supplierStore,
    transport: async (msg) => buyer.handleOffer(messageSchema.parse(JSON.parse(JSON.stringify(msg))) as OfferMsg),
    buyerAgent: buyerKey.address,
    verifier: eoaVerifier,
    rungSeconds: 900,
    // The supplier reads its own history and limit from the API too.
    exposure: {
      policy: () => fetchExposurePolicy(signedReader({ backendUrl: "http://api.test", wallet: supplierWallet, domain: D, fetch: appFetch })),
      events: (b) => fetchExposureEvents({ backendUrl: "http://api.test", side: "supplier", owner: supplierKey.address, counterparty: b, fetch: appFetch }),
    },
  });

  const result = await supplier.start({ id: INVOICE, face: invoice.amount, dueSec: invoice.dueDate, status: "approved", pastAcceptedBps: [], buyer: buyerKey.address });

  // Let each agent finish signing and delivering its log.
  for (let i = 0; i < 100; i++) {
    const a = buyerStore.status();
    const b = supplierStore.status();
    if (a.delivered === a.entries && b.delivered === b.entries) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  const log = (await (await app.request(`/api/log?invoice=${INVOICE}&limit=200`)).json()) as any;
  const verify = (await (await app.request("/api/log/verify")).json()) as any;
  return { app, db, dir, result, buyerStore, supplierStore, buyerWallet, log: log.data, verify: verify.data };
}

describe("the whole path, with the real code on both ends", () => {
  it("settles inside the credit limit, and everything the page needs is in the verified public log", async () => {
    // Limit: 2,000 starting + 20% of the 10,000 USDC settled before = 4,000. The invoice costs at most 2,000. Payroll of 3,000 is on the calendar.
    const t = await scenario({ newCounterpartyLimit: 2_000n * USD, maxLimit: 20_000n * USD, history: true, obligation: 3_000n * USD });
    expect(t.result).toMatchObject({ kind: "accepted", rateBps: 0 });
    expect(t.buyerWallet.calls).toHaveLength(1);

    // The public log: every entry delivered, signed, and checked by the server.
    expect(t.verify).toMatchObject({ ok: true });
    expect(t.log.total).toBe(t.buyerStore.all().length + t.supplierStore.all().length);

    // The calendar really came through the signed read: the buyer's kept inputs hold the 3,000 USDC payroll.
    const decisionHash = t.buyerWallet.calls[0].args[3] as string;
    const kept = t.buyerStore.preimageOf(decisionHash)!.inputs as any;
    expect(kept.treasury.obligations).toEqual([expect.objectContaining({ amount: "3000000000" })]);

    // The credit check rested on the on-chain settlement the indexer read, with its transaction and log index.
    const accept = t.log.items.find((i: any) => i.hash === decisionHash);
    expect(accept).toMatchObject({ policyVersion: "buyer-policy-1", result: "ACCEPT", actor: "buyer_agent" });
    expect(accept.snapshot.exposure).toMatchObject({ policyVersion: "exposure-3", result: "ok", evidence: [{ kind: "settlement", txHash: "0x" + "e3".repeat(32), logIndex: 4 }] });

    // Nothing private is in the public log, anywhere.
    for (const i of t.log.items) expect(findPrivateKey({ s: i.snapshot, p: i.proposal }), i.reason).toBeUndefined();
    const wire = JSON.stringify(t.log);
    expect(wire).not.toContain("5000000000"); // the buyer's reserve
    expect(wire).not.toContain("100000000000"); // its balance
    expect(wire).not.toContain("3000000000"); // its payroll

    // The page's trace builder reads the same log, and the owner's own audit replays the accepting decision from the agent's files.
    const entries = t.log.items.map(fromApiEntry).filter(Boolean) as LogEntry[];
    const trace = buildTrace(entries);
    expect(trace.accepted).toMatchObject({ rateBps: 0, code: "ACCEPT", policyVersion: "buyer-policy-1", signed: true });
    expect(trace.accepted?.credit).toEqual({ version: "exposure-3", result: "ok", evidenceCount: 1 });
    expect(auditFromFiles(t.dir, "buyer", decisionHash)).toMatchObject({ ok: true, policyVersion: "buyer-policy-1" });
  });

  it("with the same cash and the same invoice, a smaller credit limit ends in no deal, and the log says why without saying the limit", async () => {
    // Limit 1,900 USDC and no history: even the highest rung (1000 bps, price about 1,988) is over it.
    const t = await scenario({ newCounterpartyLimit: 1_900n * USD, maxLimit: 1_900n * USD, history: false, obligation: 3_000n * USD });
    expect(t.result.kind).toBe("hold_to_due");
    expect(t.buyerWallet.calls).toHaveLength(0);
    expect(t.verify).toMatchObject({ ok: true });
    const trace = buildTrace(t.log.items.map(fromApiEntry).filter(Boolean) as LogEntry[]);
    expect(trace.accepted).toBeUndefined();
    expect(trace.rungs.length).toBeGreaterThan(0);
    expect(trace.rungs.every((r) => r.code === "EXPOSURE_LIMIT")).toBe(true);
    expect(trace.noDeal?.text).toMatch(/do not meet/);
    expect(JSON.stringify(t.log)).not.toContain("1900");
  });

  it("a payroll on the calendar the buyer cannot cover ends in no deal even with a generous credit limit", async () => {
    // Cash 100,000 less the 5,000 reserve leaves 95,000; payroll 96,000 leaves nothing to spare.
    const t = await scenario({ newCounterpartyLimit: 50_000n * USD, maxLimit: 50_000n * USD, history: false, obligation: 96_000n * USD });
    expect(t.result.kind).toBe("hold_to_due");
    expect(t.buyerWallet.calls).toHaveLength(0);
    const trace = buildTrace(t.log.items.map(fromApiEntry).filter(Boolean) as LogEntry[]);
    expect(trace.rungs.every((r) => r.code === "LIQUIDITY_FLOOR")).toBe(true);
  });
});

describe("verified obligations and the supplier's history, through the real API", () => {
  it("another approved invoice the chain says the buyer owes uses up its cash, like payroll, but is marked on-chain", async () => {
    // Cash 100,000 less the 5,000 reserve leaves 95,000. Payables of 96,000 owed to someone else leave nothing: no deal. Nobody declared it.
    const t = await scenario({ newCounterpartyLimit: 50_000n * USD, maxLimit: 50_000n * USD, history: false, payable: 96_000n * USD });
    expect(t.result.kind).toBe("hold_to_due");
    expect(t.buyerWallet.calls).toHaveLength(0);
    const refused = t.buyerStore.all().find((e) => e.reasonCode === "LIQUIDITY_FLOOR")!;
    const kept = t.buyerStore.preimageOf(refused.hash)!.inputs as any;
    expect(kept.treasury.obligations).toEqual([expect.objectContaining({ id: expect.stringMatching(/^invoice:0x/), amount: "96000000000", provenance: "onchain" })]);
    expect(auditFromFiles(t.dir, "buyer", refused.hash)).toMatchObject({ ok: true });
  });

  it("the supplier starts its ladder at the 25th percentile of the rates this buyer really paid before, from chain events", async () => {
    // Three earlier early payments at 400, 600 and 600 bps; the supplier's configured start is 0.
    const t = await scenario({ newCounterpartyLimit: 50_000n * USD, maxLimit: 50_000n * USD, history: false, pastRates: [400, 600, 600] });
    expect(t.result).toMatchObject({ kind: "accepted", rateBps: 400 });
    const open = t.supplierStore.all()[0]!;
    expect(open.snapshot).toMatchObject({ pastAcceptedCount: 3 });
    // the supplier's own credit position rests on its own history and is public without any limit in it
    expect(open.snapshot).toMatchObject({ credit: { policyVersion: "exposure-1", result: "within" } });
    expect(findPrivateKey({ s: open.snapshot })).toBeUndefined();
    const items = t.log.items.filter((i: any) => i.actor === "supplier_agent");
    expect(JSON.stringify(items)).not.toContain("100000");
  });
});

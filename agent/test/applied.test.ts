import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domain, offerTypedData, type BuyerPolicy, type Domain } from "../src/core/index.js";
import { BuyerAgent, DecisionStore, PolicyBook, type AgentModel, type ChainReader, type OnChainInvoice, type ProposeArgs } from "../src/agents/index.js";
import { Vault } from "../src/agents/vault.js";
import { appliedReport } from "../src/applied.js";
import { messageSchema, type OfferMsg } from "../src/protocol/index.js";
import { eoaVerifier, type Eip712Payload, type WalletAdapter } from "../src/wallets/types.js";

const USD = 1_000_000n;
const D: Domain = domain(5042002, "0x00000000000000000000000000000000000000aa");
const BOOK = "0x00000000000000000000000000000000000000aa" as const;
const INVOICE = ("0x" + "42".repeat(32)) as `0x${string}`;
const real = () => Math.floor(Date.now() / 1000);
const KEY = "ef".repeat(32);

async function run(withChecks: boolean, dir: string) {
  const supplier = privateKeyToAccount(keccak256(toHex("supplier")));
  const buyer = privateKeyToAccount(keccak256(toHex("buyer")));
  const wallet: WalletAdapter = { mode: "agent", address: async () => buyer.address, balance: async () => 0n, signTypedData: (p: Eip712Payload) => buyer.signTypedData(p as never), execute: async () => ({ raw: {}, txHash: ("0x" + "ab".repeat(32)) as `0x${string}` }), health: async () => ({ ok: true }) };
  const onchain: OnChainInvoice = { supplier: supplier.address, buyer: buyer.address, token: "0x3600000000000000000000000000000000000000", amount: 2_000n * USD, dueDate: BigInt(real() + 30 * 86_400), approvedAt: BigInt(real()), status: "approved" };
  const chain: ChainReader = { invoice: async () => onchain, offerNonceUsed: async () => false };
  const policy: BuyerPolicy = { hurdleAprBps: 0, liquidityFloor: 0n, perInvoiceCap: 0n, dailyCap: 0n, humanAbove: 0n, feeBps: 1000 };
  const vault = new Vault(KEY);
  const stamp = new PolicyBook(join(dir, "buyer-policy.jsonl"), undefined, vault).use("buyer-policy", policy, real());
  const store = new DecisionStore({ file: join(dir, "buyer-decisions.jsonl"), vault, policy: () => stamp });
  const model: AgentModel = { propose: async <T,>({ schema }: ProposeArgs<T>) => schema.parse({ risk_flags: [], summary: "none" }) };
  const agent = new BuyerAgent({
    wallet, domain: D, model, policy, store, chain, invoiceBook: BOOK, verifier: eoaVerifier,
    treasury: async () => ({ cash: 100_000n * USD, obligations: [{ id: "o1", dueSec: BigInt(real() + 9 * 86_400), amount: 100n * USD }] }),
    ...(withChecks
      ? {
          exposure: { policy: async () => ({ version: "exposure-3", newCounterpartyLimit: 5_000n * USD, maxLimit: 5_000n * USD, growthBps: 2000, lookbackDays: 180, graceSeconds: 86_400 }), events: async () => [] },
          reputation: async () => ({ kind: "none" as const }),
        }
      : {}),
  });
  const expiry = BigInt(real() + 600);
  const nonce = withChecks ? 1n : 2n;
  const sig = await supplier.signTypedData(offerTypedData(D, { invoiceId: INVOICE, rateBps: 0, expiry, nonce }) as never);
  await agent.handleOffer(messageSchema.parse(JSON.parse(JSON.stringify({ v: 1, type: "offer", invoiceId: INVOICE, rung: 0, offer: { invoiceId: INVOICE, rateBps: 0, expiry: expiry.toString(), nonce: nonce.toString() }, offerSig: sig, from: supplier.address, ts: real() }))) as OfferMsg);
}

describe("the applied report says, from the log, which limits were really on", () => {
  it("reports the exposure limit, the calendar and the registry as applied when they were, and as NOT applied when they were not", async () => {
    const withChecks = mkdtempSync(join(tmpdir(), "misthos-applied-"));
    await run(true, withChecks);
    const on = appliedReport(withChecks, "buyer", new Vault(KEY));
    expect(on.summary).toMatchObject({ decisions: 1, exposureApplied: 1, calendarApplied: 1, registryApplied: 1 });
    expect(on.rows[0]).toMatchObject({ result: "ACCEPT", exposure: { applied: true, version: "exposure-3" }, calendar: { applied: true, entries: 1 }, registry: { applied: true, result: "none" } });
    expect(on.notApplied).toEqual([]);

    const without = mkdtempSync(join(tmpdir(), "misthos-applied-"));
    await run(false, without);
    const off = appliedReport(without, "buyer", new Vault(KEY));
    expect(off.rows[0]).toMatchObject({ exposure: { applied: false }, registry: { applied: false } });
    expect(off.notApplied).toHaveLength(1); // listed, so the run cannot be described as having had its limits on
  });

  it("never prints an amount from the calendar, and needs the key to read the sealed files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "misthos-applied-"));
    await run(true, dir);
    expect(JSON.stringify(appliedReport(dir, "buyer", new Vault(KEY)), (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("100000000"); // the 100 USDC payment
    expect(() => appliedReport(dir, "buyer")).toThrow(/AGENT_STORE_KEY/);
  });
});

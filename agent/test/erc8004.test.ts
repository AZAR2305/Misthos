import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import { agentMetadataUri, feedbackCall, registerCall, writeSettlementFeedback, ERC8004_ARC_TESTNET } from "../src/identity/erc8004";
import { functionSignature } from "../src/wallets/circleCli";
import type { ContractCall, WalletAdapter } from "../src/wallets/types";

const ID = ("0x" + "ab".repeat(32)) as `0x${string}`;
const walletThatRecords = (fail = false) => {
  const calls: ContractCall[] = [];
  const w = { execute: async (c: ContractCall) => (fail ? Promise.reject(new Error("CLI down")) : (calls.push(c), { raw: {}, txHash: ("0x" + "11".repeat(32)) as `0x${string}` })) } as unknown as WalletAdapter;
  return { w, calls };
};

describe("ERC-8004 calls", () => {
  it("use the exact signatures confirmed on the deployed Arc registries, with flat arguments only", () => {
    expect(functionSignature(registerCall(ERC8004_ARC_TESTNET.identity, "x").abi, "register")).toBe("register(string)");
    const f = feedbackCall(ERC8004_ARC_TESTNET.reputation, { agentId: 7n, invoiceId: ID });
    expect(functionSignature(f.abi, "giveFeedback")).toBe("giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)");
    expect(f.args).toEqual([7n, 100n, 0, "misthos.settlement", "early_pay", "", "", ID]);
  });

  it("encodes to calldata that the real ABI decodes back (no struct, no surprises)", () => {
    const f = feedbackCall(ERC8004_ARC_TESTNET.reputation, { agentId: 7n, invoiceId: ID });
    const abi = parseAbi([f.abi]);
    // encode through the ABI the way viem would, then decode: proves the argument list matches the signature
    
    const data = encodeFunctionData({ abi, functionName: "giveFeedback", args: f.args } as never);
    expect(decodeFunctionData({ abi, data }).args?.[0]).toBe(7n);
    expect(data.slice(0, 10)).toBe("0x3c036a7e"); // the selector present in the deployed bytecode
  });

  it("carries a stable idempotency key per agent and invoice, so a retry cannot rate twice", () => {
    const a = feedbackCall(ERC8004_ARC_TESTNET.reputation, { agentId: 7n, invoiceId: ID });
    expect(a.idempotencyKey).toBe(feedbackCall(ERC8004_ARC_TESTNET.reputation, { agentId: 7n, invoiceId: ID }).idempotencyKey);
    expect(a.idempotencyKey).not.toBe(feedbackCall(ERC8004_ARC_TESTNET.reputation, { agentId: 8n, invoiceId: ID }).idempotencyKey);
  });

  it("builds a self-contained metadata document with no private values", () => {
    const uri = agentMetadataUri({ name: "Misthos supplier agent", role: "supplier", wallet: "0x6afd3cac8e4ac3d15388b58ac999481c96ffdf6f", chainId: 5042002 });
    const doc = JSON.parse(Buffer.from(uri.split(",")[1]!, "base64").toString());
    expect(doc).toMatchObject({ name: "Misthos supplier agent", active: true });
    expect(JSON.stringify(doc)).not.toMatch(/hurdle|cost of waiting|private/i);
  });
});

describe("writing feedback after a settlement", () => {
  it("writes once with the counterparty's agent id, and writes nothing without one", async () => {
    const { w, calls } = walletThatRecords();
    expect(await writeSettlementFeedback({ wallet: w, reputation: ERC8004_ARC_TESTNET.reputation, counterpartyAgentId: 9n }, ID)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]).toBe(9n);
    expect(await writeSettlementFeedback({ wallet: w, reputation: ERC8004_ARC_TESTNET.reputation }, ID)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("never throws when the wallet fails: a rating must not affect a payment that already happened", async () => {
    const { w } = walletThatRecords(true);
    const logs: string[] = [];
    await expect(writeSettlementFeedback({ wallet: w, reputation: ERC8004_ARC_TESTNET.reputation, counterpartyAgentId: 9n, log: (m) => logs.push(m) }, ID)).resolves.toBe(false);
    expect(logs[0]).toMatch(/not written/);
  });
});

import { readRecentReputation } from "../src/identity/erc8004";
describe("reading recent reputation from the registry", () => {
  const R = ERC8004_ARC_TESTNET.reputation;
  const A = "0x" + "a1".repeat(20);
  const B = "0x" + "b2".repeat(20);
  /** A registry stand-in shaped like the real return values (value, decimals, tag1, tag2, isRevoked), indexed from 1. */
  const registry = (byClient: Record<string, [bigint, string, string, boolean][]>, fail?: string) => ({
    readContract: async (a: { functionName: string; args: unknown[] }) => {
      if (fail === a.functionName) throw new Error("registry down");
      const [, who, idx] = a.args as [bigint, string, bigint];
      if (a.functionName === "getClients") return Object.keys(byClient);
      if (a.functionName === "getLastIndex") return BigInt(byClient[who]!.length);
      const [value, tag1, tag2, revoked] = byClient[who]![Number(idx) - 1]!;
      return [value, 0, tag1, tag2, revoked];
    },
  }) as never;
  const ok: [bigint, string, string, boolean] = [100n, "misthos.settlement", "early_pay", false];

  it("no agent id, or no feedback, is a new address; a failed read throws so the buyer asks a person", async () => {
    expect(await readRecentReputation(registry({}), R, undefined)).toEqual({ kind: "none" });
    expect(await readRecentReputation(registry({}), R, 7n)).toEqual({ kind: "none" });
    await expect(readRecentReputation(registry({ [A]: [ok] }, "getLastIndex"), R, 7n)).rejects.toThrow(/registry down/);
    await expect(readRecentReputation(registry({ [A]: [ok] }, "readFeedback"), R, 7n)).rejects.toThrow(/registry down/);
  });

  it("marks a rating disputed by tag or by a negative value, ignores revoked ratings, and keeps only the 5 newest", async () => {
    const r = await readRecentReputation(
      registry({
        [A]: [ok, ok, [100n, "misthos.settlement", "disputed", false], ok, ok, ok, ok], // seven ratings; index 3 is the oldest of the five newest
        [B]: [[-5n, "x", "y", false], [100n, "x", "y", true] /* revoked */],
      }),
      R,
      7n,
    );
    expect(r.kind).toBe("read");
    if (r.kind !== "read") return;
    expect(r.recent).toHaveLength(5);
    // The 5 newest by index are A7, A6, A5, A4, A3. A3 is the disputed one and makes the cut; B1 (negative) is older than all five and does not; B2 was revoked.
    expect(r.recent.filter((x) => x.disputed)).toHaveLength(1);
  });
});

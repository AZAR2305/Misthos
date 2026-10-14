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

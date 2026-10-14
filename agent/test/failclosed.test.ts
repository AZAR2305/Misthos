import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domain, offerTypedData, type BuyerPolicy, type Domain } from "../src/core/index.js";
import { BuyerAgent, DecisionStore, ProtocolError, guardChain, type AgentModel, type ChainReader, type ProposeArgs } from "../src/agents/index.js";
import { messageSchema, type OfferMsg } from "../src/protocol/index.js";
import { classifyCliFailure, reloginCommand } from "../src/wallets/circleCli.js";
import { eoaVerifier, type ContractCall, type Eip712Payload, type WalletAdapter } from "../src/wallets/types.js";

/** What each failure does, in one place. Real-system versions of these (real CLI, real RPC, real registry) are in scripts/failclosed-matrix.ts. */
const D: Domain = domain(5042002, "0x00000000000000000000000000000000000000aa");
const INVOICE = ("0x" + "42".repeat(32)) as `0x${string}`;
const real = () => Math.floor(Date.now() / 1000);

describe("an unreachable chain: no action, and the person is told plainly", () => {
  const dead = (): ChainReader => ({
    invoice: async () => {
      throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:9");
    },
    offerNonceUsed: async () => {
      throw new TypeError("fetch failed");
    },
  });

  it("guardChain turns any read failure into CHAIN_UNAVAILABLE, and never returns a made-up invoice", async () => {
    const g = guardChain(dead());
    await expect(g.invoice(INVOICE)).rejects.toMatchObject({ name: "ProtocolError", code: "CHAIN_UNAVAILABLE" });
    await expect(g.offerNonceUsed("0x" + "11".repeat(20) as `0x${string}`, 1n)).rejects.toMatchObject({ code: "CHAIN_UNAVAILABLE" });
    await expect(g.invoice(INVOICE)).rejects.toThrow(/no action was taken/);
  });

  it("a real error type passes through unchanged (a missing invoice is NOT 'chain unavailable')", async () => {
    const g = guardChain({ invoice: async () => { throw new ProtocolError("NOT_FOUND", "x"); }, offerNonceUsed: async () => false });
    await expect(g.invoice(INVOICE)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the buyer agent answers nothing and sends nothing when it cannot read the chain", async () => {
    const supplier = privateKeyToAccount(keccak256(toHex("supplier")));
    const buyerAcct = privateKeyToAccount(keccak256(toHex("buyer")));
    const calls: ContractCall[] = [];
    const wallet: WalletAdapter = {
      mode: "agent", address: async () => buyerAcct.address, balance: async () => 0n,
      signTypedData: (p: Eip712Payload) => buyerAcct.signTypedData(p as never),
      execute: async (c) => (calls.push(c), { raw: {} }), health: async () => ({ ok: true }),
    };
    const model: AgentModel = { propose: async <T,>({ schema }: ProposeArgs<T>) => schema.parse({ risk_flags: [], summary: "none" }) };
    const policy: BuyerPolicy = { hurdleAprBps: 0, liquidityFloor: 0n, perInvoiceCap: 0n, dailyCap: 0n, humanAbove: 0n, feeBps: 1000 };
    const store = new DecisionStore();
    const agent = new BuyerAgent({ wallet, domain: D, model, policy, store, chain: guardChain(dead()), invoiceBook: "0x00000000000000000000000000000000000000aa", verifier: eoaVerifier, treasury: async () => ({ cash: 1n, obligations: [] }) });
    const expiry = BigInt(real() + 600);
    const offerSig = await supplier.signTypedData(offerTypedData(D, { invoiceId: INVOICE, rateBps: 0, expiry, nonce: 1n }) as never);
    const msg = messageSchema.parse(JSON.parse(JSON.stringify({ v: 1, type: "offer", invoiceId: INVOICE, rung: 0, offer: { invoiceId: INVOICE, rateBps: 0, expiry: expiry.toString(), nonce: "1" }, offerSig, from: supplier.address, ts: real() }))) as OfferMsg;
    await expect(agent.handleOffer(msg)).rejects.toMatchObject({ code: "CHAIN_UNAVAILABLE" });
    expect(calls).toHaveLength(0);
    expect(store.all()).toHaveLength(0); // no decision was invented
  });
});

describe("an expired Circle session tells you the exact command for that agent's own login folder", () => {
  it("names the folder, the command and what to expect", () => {
    const cmd = reloginCommand("C:/Users/thame/.misthos/circle-buyer");
    expect(cmd).toContain('$env:CIRCLE_CLI_HOME="C:/Users/thame/.misthos/circle-buyer"');
    expect(cmd).toContain("pnpm exec circle wallet login");
    expect(cmd).toContain("--testnet");
    expect(cmd).toMatch(/code Circle emails you/);
    expect(reloginCommand()).not.toContain("CIRCLE_CLI_HOME"); // no folder configured: no folder in the command
  });
  it("a real 'not logged in' answer from the CLI becomes SESSION_EXPIRED carrying that command", () => {
    const e = classifyCliFailure({ exitCode: 1, stdout: "", stderr: 'Error: Not logged in with type "agent". Run circle wallet login.' }, reloginCommand("C:/x/circle-supplier"));
    expect(e).toMatchObject({ code: "SESSION_EXPIRED" });
    expect(e.hint).toContain('CIRCLE_CLI_HOME="C:/x/circle-supplier"');
  });
});

import { CircleCliAdapter, activateCommand } from "../src/wallets/circleCli.js";
describe("a new Circle wallet must be activated once, and the person is told how in plain words", () => {
  const real = "Error: This wallet isn't deployed on-chain yet. Send any transaction first (e.g. a zero-value transfer) to deploy it before signing.";
  it("the CLI's own message becomes WALLET_NOT_ACTIVATED with the exact step for this wallet", () => {
    const e = classifyCliFailure({ exitCode: 1, stdout: "", stderr: real }, "x", { address: "0x6afd3cac8e4ac3d15388b58ac999481c96ffdf6f", cliHome: "C:/h/circle-supplier" });
    expect(e.code).toBe("WALLET_NOT_ACTIVATED");
    expect(e.message).toMatch(/not been activated/);
    expect(e.hint).toMatch(/Activate your wallet/);
    expect(e.hint).toContain("--address 0x6afd3cac8e4ac3d15388b58ac999481c96ffdf6f");
    expect(e.hint).toContain('CIRCLE_CLI_HOME="C:/h/circle-supplier"');
    expect(activateCommand()).toContain("<this wallet>");
  });
  const adapter = (code: string | undefined | null) => {
    const runner = async (args: readonly string[]) => ({ exitCode: 0, stdout: JSON.stringify(args.includes("list") ? { data: [{ address: "0x6afd3cac8e4ac3d15388b58ac999481c96ffdf6f" }] } : { ok: true }), stderr: "" });
    return new CircleCliAdapter({ address: "0x6afd3cac8e4ac3d15388b58ac999481c96ffdf6f", runner, codeOf: async () => code as never });
  };
  it("health says so before anything is signed: no code on chain means not activated", async () => {
    const h = await adapter("0x").health();
    expect(h.ok).toBe(false);
    expect(h.detail).toMatch(/^WALLET_NOT_ACTIVATED: .*Activate your wallet/);
    expect((await adapter("0x7f").health()).ok).toBe(true);
  });
});

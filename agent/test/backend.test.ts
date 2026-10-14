import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentReadTypedData, domain } from "../src/core/index.js";
import { fetchExposureEvents, fetchExposurePolicy, linkAgent, signedReader } from "../src/agents/backend.js";
import type { WalletAdapter } from "../src/wallets/types.js";

const D = domain(5042002, "0x00000000000000000000000000000000000000aa");
const account = privateKeyToAccount(("0x" + "77".repeat(32)) as `0x${string}`);
const wallet = { address: async () => account.address, signTypedData: (p: unknown) => account.signTypedData(p as never) } as unknown as WalletAdapter;
const NOW = 1_800_000_000;

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

/** Stands in for the API: it checks the signature the way the real endpoint does, then answers with the given rows. */
async function api(rows: unknown, status = 200) {
  const seen: { path?: string; signer?: string } = {};
  server = createServer(async (req, res) => {
    seen.path = req.url;
    // Public reads carry no signature; signed reads are checked the way the real endpoint checks them.
    if (req.headers["x-agent-sig"]) {
      const ts = Number(req.headers["x-agent-ts"]);
      const nonce = String(req.headers["x-agent-nonce"] ?? "");
      seen.signer = await recoverTypedDataAddress({ ...agentReadTypedData(D, { resource: req.url ?? "", ts, nonce }), signature: req.headers["x-agent-sig"] as `0x${string}` } as never);
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(status === 200 ? { ok: true, data: rows } : { ok: false, error: { message: "nope" } }));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

describe("the exposure policy and history reads", () => {
  it("parses the owner's policy into integer limits and reports not-configured as null", async () => {
    const set = await api({ configured: true, version: "exposure-2", newCounterpartyLimit: "5000000000", maxLimit: "20000000000", growthBps: 2000, lookbackDays: 180, graceSeconds: 86400 });
    expect(await fetchExposurePolicy(signedReader({ backendUrl: set.url, wallet, domain: D, now: () => NOW }))).toEqual({
      version: "exposure-2", newCounterpartyLimit: 5_000_000_000n, maxLimit: 20_000_000_000n, growthBps: 2000, lookbackDays: 180, graceSeconds: 86400,
    });
    expect(set.seen.path).toBe("/api/agent/exposure-policy");
    await new Promise<void>((r) => server!.close(() => r()));
    const none = await api({ configured: false });
    expect(await fetchExposurePolicy(signedReader({ backendUrl: none.url, wallet, domain: D }))).toBeNull();
  });

  it("an unexpected policy reply throws instead of becoming a default", async () => {
    const odd = await api({ configured: true, version: "x", newCounterpartyLimit: "-5", maxLimit: "1", growthBps: 1, lookbackDays: 1, graceSeconds: 1 });
    await expect(fetchExposurePolicy(signedReader({ backendUrl: odd.url, wallet, domain: D }))).rejects.toThrow();
  });

  it("parses chain-derived history into bigint events, and throws when the API is unreachable", async () => {
    const a = await api({ events: [{ invoiceId: "0xaa", state: "settled_early", face: "4000000000", outflow: "3900000000", dueSec: NOW + 100, settledAtSec: NOW - 50, txHash: "0xtx", logIndex: 2 }, { invoiceId: "0xbb", state: "approved", face: "1", dueSec: 5 }] });
    const events = await fetchExposureEvents({ backendUrl: a.url, side: "buyer", owner: "0xAbC", counterparty: "0xDeF" });
    expect(events).toEqual([
      { invoiceId: "0xaa", state: "settled_early", face: 4_000_000_000n, outflow: 3_900_000_000n, dueSec: BigInt(NOW + 100), settledAtSec: BigInt(NOW - 50), txHash: "0xtx", logIndex: 2 },
      { invoiceId: "0xbb", state: "approved", face: 1n, dueSec: 5n },
    ]);
    expect(a.seen.path).toContain("side=buyer");
    expect(a.seen.path).toContain("owner=0xabc");
    await new Promise<void>((r) => server!.close(() => r()));
    await expect(fetchExposureEvents({ backendUrl: a.url, side: "buyer", owner: "0xa", counterparty: "0xb", timeoutMs: 500 })).rejects.toThrow();
  });
});

describe("redeeming a link code", () => {
  it("signs the exact path, which contains the code, with the agent wallet", async () => {
    const a = await api({ linked: true });
    expect(await linkAgent({ backendUrl: a.url, wallet, domain: D, code: "ABCD-EFGH-JKLM", now: () => NOW })).toEqual({ ok: true });
    expect(a.seen.path).toBe("/api/agent/link/ABCD-EFGH-JKLM");
    expect(a.seen.signer).toBe(account.address);
  });
  it("reports why it failed, and never throws", async () => {
    const refused = await api(null, 403);
    expect(await linkAgent({ backendUrl: refused.url, wallet, domain: D, code: "X" })).toEqual({ ok: false, message: "nope" });
    await new Promise<void>((r) => server!.close(() => r()));
    const down = await linkAgent({ backendUrl: refused.url, wallet, domain: D, code: "X", timeoutMs: 500 });
    expect(down.ok).toBe(false);
    expect(down.ok === false && down.message).toMatch(/Could not reach the API/);
  });
});

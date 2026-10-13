import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentReadTypedData, domain } from "../src/core/index.js";
import { fetchObligations, signedReader } from "../src/agents/backend.js";
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
    const ts = Number(req.headers["x-agent-ts"]);
    const signer = await recoverTypedDataAddress({ ...agentReadTypedData(D, { resource: req.url ?? "", ts }), signature: req.headers["x-agent-sig"] as `0x${string}` } as never);
    seen.path = req.url;
    seen.signer = signer;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(status === 200 ? { ok: true, data: rows } : { ok: false, error: { message: "nope" } }));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

describe("the buyer agent's signed read of its payment calendar", () => {
  it("signs the path and the time with its wallet and returns the rows as declared obligations", async () => {
    const a = await api([{ id: "o1", amount: "3000000000", dueSec: NOW + 86_400, kind: "payroll", provenance: "declared" }]);
    const out = await fetchObligations(signedReader({ backendUrl: a.url, wallet, domain: D, now: () => NOW }));
    expect(out).toEqual([{ id: "o1", dueSec: BigInt(NOW + 86_400), amount: 3_000_000_000n, provenance: "declared" }]);
    expect(a.seen.path).toBe("/api/agent/obligations");
    expect(a.seen.signer).toBe(account.address);
  });

  it("an empty calendar is empty", async () => {
    const a = await api([]);
    expect(await fetchObligations(signedReader({ backendUrl: a.url, wallet, domain: D }))).toEqual([]);
  });

  it("throws, never defaults, when the API refuses, is unreachable, or sends something unexpected", async () => {
    const refused = await api(null, 403);
    await expect(fetchObligations(signedReader({ backendUrl: refused.url, wallet, domain: D }))).rejects.toThrow(/nope/);
    await new Promise<void>((r) => server!.close(() => r()));
    await expect(fetchObligations(signedReader({ backendUrl: refused.url, wallet, domain: D, timeoutMs: 500 }))).rejects.toThrow();
    const odd = await api([{ id: "x", amount: "-5", dueSec: 1, kind: "other", provenance: "declared" }]);
    await expect(fetchObligations(signedReader({ backendUrl: odd.url, wallet, domain: D }))).rejects.toThrow();
    const verified = await api([{ id: "x", amount: "5", dueSec: 1, kind: "other", provenance: "onchain" }]);
    await expect(fetchObligations(signedReader({ backendUrl: verified.url, wallet, domain: D }))).rejects.toThrow();
  });
});

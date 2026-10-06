import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { decisionTypedData, domain } from "../src/core/index.js";
import { DecisionStore } from "../src/agents/store.js";

const D = domain(5042002, "0x00000000000000000000000000000000000000b1");
const input = (n: number) => ({ actor: "buyer_agent" as const, invoiceId: "0x" + "ab".repeat(32), snapshot: { n, amount: 1_000_000n }, proposal: null, outcome: "auto_apply" as const, reason: `decision ${n}` });
const tmp = () => join(mkdtempSync(join(tmpdir(), "misthos-log-")), "buyer-decisions.jsonl");

describe("decision log", () => {
  it("survives a restart and keeps the chain", () => {
    const file = tmp();
    const a = new DecisionStore({ file });
    a.append(input(1), 100);
    a.append(input(2), 101);
    const b = new DecisionStore({ file });
    expect(b.all().map((e) => e.hash)).toEqual(a.all().map((e) => e.hash));
    expect(b.verify()).toEqual({ ok: true });
    const c = b.append(input(3), 102);
    expect(c.seq).toBe(2);
    expect(c.prevHash).toBe(a.all()[1]!.hash);
  });

  it("refuses to start on a log that was edited after it was written", () => {
    const file = tmp();
    const a = new DecisionStore({ file });
    a.append(input(1), 100);
    a.append(input(2), 101);
    writeFileSync(file, readFileSync(file, "utf8").replace("decision 1", "decision X"));
    expect(() => new DecisionStore({ file })).toThrow(/does not verify/);
  });

  it("signs every entry with the wallet and delivers it once, in order, retrying when the backend is down", async () => {
    const file = tmp();
    const acct = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
    let down = true;
    const delivered: number[] = [];
    const store = new DecisionStore({
      file,
      retryMs: 5,
      warn: () => {},
      attest: async (e) => ({ signer: acct.address, signature: await acct.signTypedData(decisionTypedData(D, e) as never) }),
      push: async (entries) => {
        if (down) throw new Error("backend unreachable");
        delivered.push(...entries.map((e) => e.seq));
      },
    });
    store.append(input(1), 100);
    store.append(input(2), 101);
    await new Promise((r) => setTimeout(r, 40));
    expect(store.all().every((e) => e.signature)).toBe(true);
    expect(delivered).toEqual([]);
    down = false;
    await new Promise((r) => setTimeout(r, 80));
    expect(delivered).toEqual([0, 1]);
    expect(store.status()).toMatchObject({ entries: 2, signed: 2, delivered: 2 });
    // after a restart nothing is signed or delivered twice
    const again = new DecisionStore({ file, push: async (e) => void delivered.push(...e.map((x) => x.seq)), attest: async () => { throw new Error("must not sign again"); } });
    again.kick();
    await new Promise((r) => setTimeout(r, 30));
    expect(delivered).toEqual([0, 1]);
  });
});

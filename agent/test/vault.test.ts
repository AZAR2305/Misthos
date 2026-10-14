import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ObligationStore, ObligationUnavailableError } from "../src/agents/obligations";
import { PolicyBook } from "../src/agents/policybook";
import { DecisionStore } from "../src/agents/store";
import { SEALED_PREFIX, Vault, VaultError, vaultFromEnv } from "../src/agents/vault";

const KEY = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const dir = () => mkdtempSync(join(tmpdir(), "misthos-vault-"));
const allText = (d: string) => readdirSync(d).map((f) => readFileSync(join(d, f), "utf8")).join("\n");

describe("the vault", () => {
  it("round-trips, uses a fresh nonce each time, and refuses a wrong key or a changed byte", () => {
    const v = new Vault(KEY);
    const a = v.seal("hurdle 750");
    expect(a.startsWith(SEALED_PREFIX)).toBe(true);
    expect(a).not.toContain("hurdle");
    expect(v.seal("hurdle 750")).not.toBe(a);
    expect(v.open(a)).toBe("hurdle 750");
    expect(() => new Vault(OTHER).open(a)).toThrow(VaultError);
    const raw = Buffer.from(a.slice(SEALED_PREFIX.length), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => v.open(SEALED_PREFIX + raw.toString("base64"))).toThrow(/wrong or the file was changed/);
  });

  it("accepts hex or base64 keys of 32 bytes only, and a process with no key does not start", () => {
    expect(() => new Vault("short")).toThrow(/32 random bytes/);
    expect(() => new Vault(Buffer.alloc(31).toString("base64"))).toThrow(VaultError);
    expect(new Vault(Buffer.alloc(32, 7).toString("base64")).open(new Vault(Buffer.alloc(32, 7).toString("hex")).seal("same key two spellings"))).toBe("same key two spellings");
    expect(() => vaultFromEnv(undefined)).toThrow(/AGENT_STORE_KEY/);
  });
});

describe("the payment calendar", () => {
  it("is encrypted on disk, readable with the key, and unavailable until it is declared", () => {
    const d = dir();
    const store = new ObligationStore(d, new Vault(KEY));
    expect(store.declared()).toBe(false);
    expect(() => store.list()).toThrow(ObligationUnavailableError); // fail closed: an undeclared calendar is not an empty one
    const item = store.add({ label: "Payroll October", amount: "12345678901", dueSec: String(Math.floor(Date.now() / 1000) + 86_400), kind: "payroll" });
    expect(store.list()).toEqual([item]);
    const onDisk = allText(d);
    expect(onDisk).not.toMatch(/Payroll|12345678901/); // neither the label nor the amount is visible at rest
    expect(() => new ObligationStore(d, new Vault(OTHER)).list()).toThrow(VaultError);
    expect(new ObligationStore(d, new Vault(KEY)).list()).toHaveLength(1);
    expect(store.remove(item.id)).toBe(true);
    expect(store.remove(item.id)).toBe(false);
    expect(store.list()).toEqual([]); // declared and empty is a statement, not a failure
  });

  it("can declare no obligations explicitly, and rejects bad input", () => {
    const d = dir();
    const store = new ObligationStore(d, new Vault(KEY));
    store.declareNone();
    expect(store.list()).toEqual([]);
    expect(() => store.add({ label: "", amount: "5", dueSec: "9999999999", kind: "bill" })).toThrow();
    expect(() => store.add({ label: "x", amount: "-5", dueSec: "9999999999", kind: "bill" })).toThrow();
    expect(() => store.add({ label: "x", amount: "1.5", dueSec: "9999999999", kind: "bill" })).toThrow(); // no decimals: minor units only
    expect(() => store.add({ label: "x", amount: "5", dueSec: "1", kind: "bill" })).toThrow(/past/);
  });
});

describe("the decision log and policy files", () => {
  it("keep the private preimage and policy parameters encrypted, and still reload and replay", () => {
    const d = dir();
    const vault = new Vault(KEY);
    const book = new PolicyBook(join(d, "buyer-policy.jsonl"), undefined, vault);
    const stamp = book.use("buyer-policy", { hurdleAprBps: 731, liquidityFloor: "424242424" }, 1_800_000_000);
    const file = join(d, "buyer-decisions.jsonl");
    const log = new DecisionStore({ file, vault, policy: () => stamp });
    const e = log.append({ actor: "buyer_agent", invoiceId: "0x" + "11".repeat(32), snapshot: { rung: 0 }, proposal: null, outcome: "auto_apply", reason: "ok", private: { hurdleAprBps: 731, cash: "99999999999" } }, 1_800_000_001);
    const text = allText(d);
    expect(text).not.toMatch(/hurdleAprBps|liquidityFloor|"cash"|424242424|99999999999/); // no private name or number is readable at rest
    expect(text).toContain(e.hash); // the public hash chain is
    // restart: the same key reads everything back, so a decision can still be audited
    const again = new DecisionStore({ file, vault, policy: () => stamp });
    expect(again.preimageOf(e.hash)).toMatchObject({ inputs: { hurdleAprBps: 731, cash: "99999999999" } });
    expect(new PolicyBook(join(d, "buyer-policy.jsonl"), undefined, vault).byVersion(stamp.version)?.params).toMatchObject({ hurdleAprBps: 731 });
    // without the key the sealed files are refused loudly, never read as empty
    expect(() => new DecisionStore({ file })).toThrow(/AGENT_STORE_KEY/);
    expect(() => new PolicyBook(join(d, "buyer-policy.jsonl"))).toThrow(/AGENT_STORE_KEY/);
    expect(() => new DecisionStore({ file, vault: new Vault(OTHER) })).toThrow(VaultError);
  });

  it("still reads an older plaintext file (written before encryption existed)", () => {
    const d = dir();
    const log = new DecisionStore({ file: join(d, "old.jsonl") });
    const e = log.append({ actor: "buyer_agent", invoiceId: "0x" + "22".repeat(32), snapshot: {}, proposal: null, outcome: "auto_apply", reason: "ok" }, 1_800_000_001);
    expect(new DecisionStore({ file: join(d, "old.jsonl"), vault: new Vault(KEY) }).all()[0]!.hash).toBe(e.hash);
  });
});

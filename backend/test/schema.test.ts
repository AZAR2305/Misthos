import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/** Applies db/schema.sql to a real Postgres engine (PGlite) and checks the constraints the spec relies on. */
let db: PGlite;

const id = () => crypto.randomUUID();
const hex32 = (c: string) => "0x" + c.repeat(64);

async function org(role: "supplier" | "buyer") {
  const r = await db.query<{ id: string }>("insert into organizations (name, role) values ($1, $2) returning id", [`${role} org`, role]);
  return r.rows[0]!.id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
});

describe("schema", () => {
  it("applies cleanly and starts empty (no seed rows)", async () => {
    const tables = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'");
    expect(tables.rows.length).toBeGreaterThanOrEqual(20);
    for (const t of ["organizations", "invoices", "decisions", "chain_events", "jobs"]) {
      const n = await db.query<{ n: string }>(`select count(*)::text as n from ${t}`);
      expect(n.rows[0]!.n).toBe("0");
    }
  });

  it("rejects a supplier invoicing itself, a zero amount and a malformed invoice id", async () => {
    const s = await org("supplier");
    const b = await org("buyer");
    const insert = (supplier: string, buyer: string, amount: string, chainId: string) =>
      db.query("insert into invoices (chain_id_hex, supplier_org, buyer_org, amount, due_date, ref_hash, nonce) values ($1,$2,$3,$4, now() + interval '30 days', '0x00', 1)", [chainId, supplier, buyer, amount]);
    await expect(insert(s, s, "10", hex32("a"))).rejects.toThrow();
    await expect(insert(s, b, "0", hex32("b"))).rejects.toThrow();
    await expect(insert(s, b, "10", "0xNOTHEX")).rejects.toThrow();
    await insert(s, b, "2000.000000", hex32("c"));
    await expect(insert(s, b, "5", hex32("c"))).rejects.toThrow(); // chain_id_hex is unique
  });

  it("keeps money exact to six decimals", async () => {
    const r = await db.query<{ amount: string }>("select amount::text from invoices where chain_id_hex = $1", [hex32("c")]);
    expect(r.rows[0]!.amount).toBe("2000.000000");
  });

  it("requires lowercase wallet addresses and unique addresses", async () => {
    const o = await org("buyer");
    const ins = (addr: string) => db.query("insert into wallets (org_id, address, purpose, mode) values ($1,$2,'treasury','managed')", [o, addr]);
    await expect(ins("0xAbC0000000000000000000000000000000000001")).rejects.toThrow();
    await ins("0xabc0000000000000000000000000000000000001");
    await expect(ins("0xabc0000000000000000000000000000000000001")).rejects.toThrow();
  });

  it("dedupes chain events on (tx_hash, log_index) and decisions on hash", async () => {
    const ev = () => db.query("insert into chain_events (tx_hash, log_index, block, name, payload_json) values ('0x01', 0, 1, 'EarlySettled', '{}')");
    await ev();
    await expect(ev()).rejects.toThrow();
    const dec = (h: string) => db.query("insert into decisions (actor, snapshot_json, outcome, reason, prev_hash, hash) values ('buyer_agent', '{}', 'auto_apply', 'r', '0x0', $1)", [h]);
    await dec("0xh1");
    await expect(dec("0xh1")).rejects.toThrow();
  });

  it("makes chain writes idempotent through the jobs outbox", async () => {
    const job = () => db.query("insert into jobs (idempotency_key, kind, payload_json) values ('settle:0xabc:1', 'settle', '{}')");
    await job();
    await expect(job()).rejects.toThrow();
  });

  it("bounds rates at the 50% ceiling and stores only a claim token hash", async () => {
    const s = await org("supplier");
    const b = await org("buyer");
    const inv = await db.query<{ id: string }>("insert into invoices (chain_id_hex, supplier_org, buyer_org, amount, due_date, ref_hash, nonce) values ($1,$2,$3,10, now() + interval '5 days','0x00',2) returning id", [hex32("d"), s, b]);
    const invoiceId = inv.rows[0]!.id;
    await expect(
      db.query("insert into offers (invoice_id, rung, rate_bps, expiry, nonce, signature) values ($1,0,5001, now(), 1, '0x')", [invoiceId]),
    ).rejects.toThrow();
    await db.query("insert into offers (invoice_id, rung, rate_bps, expiry, nonce, signature) values ($1,0,0, now(), 1, '0x')", [invoiceId]);
    const cols = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'standing_offers'");
    expect(cols.rows.map((c) => c.column_name)).toContain("claim_token_hash");
    expect(cols.rows.map((c) => c.column_name)).not.toContain("claim_token");
    void id;
  });
});

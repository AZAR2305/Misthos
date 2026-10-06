import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

/**
 * One tiny interface over two real Postgres engines: node-postgres for a server, PGlite (Postgres in WebAssembly) for
 * local runs and tests. Money and bigint columns are read with a ::text cast in SQL and parsed with BigInt, never floats.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  /** Runs fn inside one transaction; rolls back if it throws. */
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

type Queryable = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> };

function wrap(q: Queryable, tx: Db["tx"], close: Db["close"], exec: Db["exec"]): Db {
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await q.query(sql, params)).rows as T[],
    exec,
    tx,
    close,
  };
}

function pgliteDb(p: PGlite): Db {
  const fromTx = (t: { query: PGlite["query"]; exec: PGlite["exec"] }): Db =>
    wrap(
      t as unknown as Queryable,
      () => {
        throw new Error("nested transactions are not supported");
      },
      async () => {},
      async (sql) => void (await t.exec(sql)),
    );
  return wrap(
    p as unknown as Queryable,
    (fn) => p.transaction((t) => fn(fromTx(t as never))),
    () => p.close(),
    async (sql) => void (await p.exec(sql)),
  );
}

function pgDb(pool: pg.Pool): Db {
  const fromClient = (c: pg.PoolClient): Db =>
    wrap(
      c as unknown as Queryable,
      () => {
        throw new Error("nested transactions are not supported");
      },
      async () => {},
      async (sql) => void (await c.query(sql)),
    );
  return wrap(
    pool as unknown as Queryable,
    async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        const r = await fn(fromClient(c));
        await c.query("commit");
        return r;
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    () => pool.end(),
    async (sql) => void (await pool.query(sql)),
  );
}

/** postgres://... for a server, pglite://memory for tests, pglite://./some/folder for an embedded local database. */
export async function openDb(url: string): Promise<Db> {
  if (url.startsWith("pglite://")) {
    const target = url.slice("pglite://".length);
    if (target === "memory" || target === "") return pgliteDb(new PGlite());
    mkdirSync(dirname(target), { recursive: true });
    return pgliteDb(new PGlite(target));
  }
  return pgDb(new pg.Pool({ connectionString: url }));
}

const MIGRATIONS = ["schema.sql", "002_accounts_indexer.sql", "003_nonces_claims.sql"];

/** Applies each migration file once, in order, and remembers which ran. Safe to call on every boot. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const ran: string[] = [];
  for (const name of MIGRATIONS) {
    if (done.has(name)) continue;
    const sql = readFileSync(new URL(`../db/${name}`, import.meta.url), "utf8");
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query("insert into schema_migrations (name) values ($1)", [name]);
    });
    ran.push(name);
  }
  return ran;
}

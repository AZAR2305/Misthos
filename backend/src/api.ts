import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { recoverTypedDataAddress, type Address, type Hex, type PublicClient } from "viem";
import { z } from "zod";
import {
  AuthError,
  COOKIE,
  accountFromToken,
  signInWithWallet,
  chooseSide,
  createChallenge,
  createSession,
  destroySession,
  stepOf,
  verifyWalletMessage,
  type Account,
} from "./auth";
import type { Config } from "./config";
import type { Db } from "./db";
import { blockTimes, getCursor, loadInvoices, type IndexerStatus } from "./indexer";
import { enqueue, getJob } from "./jobs";
import { exposureEvents, payablesOf, toInvoiceEvents } from "./exposure";
import type { Relayer, RegisterPayload } from "./relayer";
import { rateLimit } from "./ratelimit";
import { fromNumeric, ser, toNumeric } from "./serialize";
import { GENESIS_HASH, agentReadTypedData, decisionTypedData, evaluateExposure, findPrivateKey, hashDecision, INVOICE_BOOK_ABI, balanced, domain, invoiceId, invoiceTypedData, offerTypedData, journalFrom, settlementRows, summarise, toBeancount, toCsv, verifyChain, type InvoiceRecord, type StoredDecision } from "./shared";

export interface AppDeps {
  config: Config;
  db: Db;
  /** Chain reads. Without it the API says "chain unavailable" rather than guessing. */
  client?: PublicClient;
  relayer?: Relayer;
  indexer?: { status: IndexerStatus };
  now?: () => Date;
}

type Env = { Variables: { account: Account | null } };

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an address").transform((s) => s.toLowerCase() as Address);
const hex = (len?: number) => z.string().regex(len ? new RegExp(`^0x[0-9a-fA-F]{${len}}$`) : /^0x[0-9a-fA-F]*$/, "not hex").transform((s) => s as Hex);
const minor = z.string().regex(/^\d{1,30}$/, "a whole number of USDC minor units (6 decimals)");

/** The REST API (spec 9.2). Every response is { ok, data, error }. Reads are public; writes need a session. Secrets never leave. */
export function createApp(d: AppDeps) {
  const { config, db } = d;
  const now = d.now ?? (() => new Date());
  const app = new Hono<Env>();

  const ok = (c: Context, data: unknown, status: 200 | 201 | 202 = 200) => c.json({ ok: true, data: ser(data), error: null }, status);
  const fail = (c: Context, code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 501 | 503) =>
    c.json({ ok: false, data: null, error: { code, message } }, status);
  const unavailable = (c: Context, what: string, how: string) => fail(c, "UNAVAILABLE", `Unavailable: ${what}. ${how}`, 503);

  app.use("/api/*", cors({ origin: (o) => (config.ORIGINS.includes(o) ? o : null), credentials: true, allowHeaders: ["content-type"], allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));

  // A browser always sends Origin on a write. Refuse writes from any page that is not ours (cookie sessions need this).
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "OPTIONS") {
      const origin = c.req.header("origin");
      if (origin && !config.ORIGINS.includes(origin)) return fail(c, "BAD_ORIGIN", "This origin may not call the API.", 403);
    }
    await next();
  });

  // Guessing games get a tight window: sign-in, wallet linking and (later) claim links.
  const limited = (limit: number) => rateLimit({ limit, windowMs: 60_000, trustProxy: config.TRUST_PROXY === "true", now: d.now ? () => d.now!().getTime() : undefined });
  app.use("/api/auth/*", limited(config.RATE_LIMIT_PER_MIN));
  app.use("/api/claims/*", limited(config.RATE_LIMIT_PER_MIN));

  app.use("/api/*", async (c, next) => {
    c.set("account", await accountFromToken(db, getCookie(c, COOKIE), now()));
    await next();
  });

  app.onError((e, c) => {
    if (e instanceof AuthError) return fail(c, e.code, e.message, e.status as 400 | 401 | 403 | 409);
    if (e instanceof z.ZodError) return fail(c, "BAD_REQUEST", e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), 400);
    console.error(e);
    return fail(c, "INTERNAL", "Something failed on the server. It was logged.", 500);
  });
  app.notFound((c) => fail(c, "NOT_FOUND", "No such route.", 404));

  const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new z.ZodError([{ code: "custom", path: [], message: "expected a JSON body", input: undefined }]);
    }
    return schema.parse(json);
  };
  const need = (c: Context<Env>, side?: "supplier" | "buyer"): Account => {
    const a = c.get("account");
    if (!a) throw new AuthError("Sign in first.", "SIGNED_OUT", 401);
    if (side) {
      if (!a.address) throw new AuthError("Link your wallet first.", "WALLET_REQUIRED", 409);
      if (a.side !== side) throw new AuthError(`This needs a ${side} account. Yours is ${a.side ?? "not set up yet"}.`, "WRONG_SIDE", 403);
    }
    return a;
  };
  const me = (a: Account) => ({ id: a.id, name: a.name, side: a.side, address: a.address, addressBoundAt: a.addressBoundAt, step: stepOf(a) });

  // ------------------------------------------------------------------------------------------------ health

  app.get("/api/health", async (c) => {
    let dbOk = false;
    try {
      dbOk = (await db.query("select 1 as ok")).length === 1;
    } catch {
      /* reported below */
    }
    let rpc: { ok: boolean; head?: bigint; error?: string } = { ok: false, error: config.ARC_RPC_URL ? "not checked" : "ARC_RPC_URL is not set" };
    if (d.client) {
      try {
        rpc = { ok: true, head: await d.client.getBlockNumber() };
      } catch (e) {
        rpc = { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "unreachable" };
      }
    }
    const cursor = await getCursor(db).catch(() => null);
    return ok(c, {
      db: { ok: dbOk },
      rpc,
      contract: { configured: !!config.INVOICE_BOOK, address: config.INVOICE_BOOK ?? null, chainId: config.ARC_CHAIN_ID },
      indexer: { cursor, lag: rpc.head !== undefined && cursor !== null ? rpc.head - cursor : null, lastError: d.indexer?.status.lastError ?? null, running: !!d.indexer },
      relayer: { configured: !!d.relayer },
      dataSource: config.DATA_SOURCE,
    });
  });

  // ------------------------------------------------------------------------------------------------ sign-in and account

  app.post("/api/auth/logout", async (c) => {
    await destroySession(db, getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: "/" });
    return ok(c, { signedOut: true });
  });

  app.get("/api/me", (c) => {
    const a = c.get("account");
    return ok(c, a ? me(a) : null);
  });

  /** Step one of signing in: a one-time message for this wallet and this site. No session is needed; none exists yet. */
  app.post("/api/auth/wallet/challenge", async (c) => {
    const { address: addr } = await body(c, z.object({ address }));
    // The site the message names is the page that asked, so a signature collected on a look-alike site is worthless here.
    const site = c.req.header("origin") && config.ORIGINS.includes(c.req.header("origin")!) ? c.req.header("origin")! : (config.ORIGINS[0] ?? "unknown");
    return ok(c, await createChallenge(db, addr, config.ARC_CHAIN_ID, site, now()));
  });

  /** Step two: the signed message. Finds or creates the account for that address and starts the session. */
  app.post("/api/auth/wallet/signin", async (c) => {
    const b = await body(c, z.object({ address, nonce: z.string().min(8), signature: hex() }));
    const account = await signInWithWallet(db, b, (message, signature, addr) => verifyWalletMessage({ client: d.client, address: addr, message, signature }), now());
    const s = await createSession(db, account.id, config.SESSION_TTL_DAYS, now());
    setCookie(c, COOKIE, s.token, { httpOnly: true, sameSite: "Lax", secure: config.COOKIE_SECURE === "true", path: "/", expires: s.expiresAt });
    return ok(c, me(account));
  });

  app.put("/api/me/side", async (c) => {
    const a = need(c);
    const b = await body(c, z.object({ side: z.enum(["supplier", "buyer"]), confirm: z.boolean().default(false) }));
    return ok(c, me(await chooseSide(db, a, b.side, b.confirm)));
  });

  // ------------------------------------------------------------------------------------------------ public reads from the index

  const indexed = async (): Promise<InvoiceRecord[]> => loadInvoices(db);

  /**
   * The history the exposure limit is computed from: the invoices between two businesses, from indexed chain events only, each
   * settlement with its transaction hash and log index. Public chain data, so no sign-in. The agents compute the decision
   * themselves from these rows, so this API is never the authority on a limit.
   */
  app.get("/api/exposure", async (c) => {
    const q = z.object({ side: z.enum(["supplier", "buyer"]), owner: address, counterparty: address }).parse(c.req.query());
    const records = await indexed();
    return ok(c, { events: exposureEvents(records, q, await blockTimes(db)), indexedThroughBlock: (await getCursor(db))?.toString() ?? null });
  });

  /** What a buyer owes on approved, unpaid invoices: on-chain facts, so the one obligation that is verified, not declared. */
  app.get("/api/payables", async (c) => {
    const q = z.object({ buyer: address }).parse(c.req.query());
    return ok(c, { payables: payablesOf(await indexed(), q.buyer), indexedThroughBlock: (await getCursor(db))?.toString() ?? null });
  });

  app.get("/api/invoices", async (c) => {
    const q = z
      .object({
        status: z.enum(["registered", "approved", "disputed", "settled_early", "settled_due"]).optional(),
        supplier: address.optional(),
        buyer: address.optional(),
        q: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(c.req.query());
    const all = await indexed();
    const needle = q.q?.toLowerCase();
    const rows = all
      .filter((i) => (!q.status || i.status === q.status) && (!q.supplier || i.supplier === q.supplier) && (!q.buyer || i.buyer === q.buyer))
      .filter((i) => !needle || i.id.includes(needle) || i.supplier.includes(needle) || i.buyer.includes(needle) || i.refHash.includes(needle))
      .sort((a, b) => (a.registered.block === b.registered.block ? 0 : a.registered.block < b.registered.block ? 1 : -1));
    return ok(c, { total: rows.length, items: rows.slice(q.offset, q.offset + q.limit) });
  });

  app.get("/api/invoices/:id", async (c) => {
    const id = c.req.param("id").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(id)) return fail(c, "BAD_REQUEST", "An invoice id is 0x followed by 64 hex characters.", 400);
    const inv = (await indexed()).find((i) => i.id === id);
    if (!inv) return fail(c, "NOT_FOUND", "No such invoice in the index yet. It may still be indexing.", 404);
    const events = await db.query<{ tx_hash: string; log_index: number; block: string; name: string; payload_json: unknown }>(
      "select tx_hash, log_index, block::text as block, name, payload_json from chain_events where payload_json->>'id' = $1 order by block, log_index",
      [id],
    );
    return ok(c, { invoice: inv, events });
  });

  app.get("/api/stats", async (c) => {
    const rows = settlementRows(await indexed(), await blockTimes(db));
    return ok(c, { source: config.DATA_SOURCE, summary: summarise(rows), settlements: rows });
  });

  const journalFor = async (c: Context<Env>) => {
    const q = z.object({ side: z.enum(["supplier", "buyer"]).optional(), address: address.optional() }).parse(c.req.query());
    const a = c.get("account");
    const addr = q.address ?? a?.address;
    const side = q.side ?? a?.side;
    if (!addr || !side) throw new z.ZodError([{ code: "custom", path: ["address"], message: "give ?address=0x…&side=supplier|buyer, or sign in", input: undefined }]);
    return { lines: journalFrom(side, await indexed(), addr), time: await blockTimes(db) };
  };
  app.get("/api/ledger", async (c) => {
    const { lines } = await journalFor(c);
    return ok(c, { balanced: balanced(lines), lines });
  });
  app.get("/api/ledger.csv", async (c) => {
    const { lines, time } = await journalFor(c);
    return c.body(toCsv(lines, time), 200, { "content-type": "text/csv; charset=utf-8" });
  });
  app.get("/api/ledger.beancount", async (c) => {
    const { lines, time } = await journalFor(c);
    return c.body(toBeancount(lines, time), 200, { "content-type": "text/plain; charset=utf-8" });
  });

  // ------------------------------------------------------------------------------------------------ the signed decision log (spec 8.4)

  type LogRow = { prev_hash: string; actor: StoredDecision["actor"]; snapshot_json: unknown; proposal_json: unknown; outcome: StoredDecision["outcome"]; reason: string; hash: string; signer: string; seq: string; signature: string };

  const attestationOk = async (e: { signer: Address; signature: Hex; hash: Hex; prevHash: Hex; actor: string; seq: number }) => {
    if (!config.INVOICE_BOOK) return false;
    const td = decisionTypedData(domain(config.ARC_CHAIN_ID, config.INVOICE_BOOK), e);
    try {
      if ((await recoverTypedDataAddress({ ...td, signature: e.signature })).toLowerCase() === e.signer) return true;
    } catch {
      /* may be a contract wallet */
    }
    return d.client ? d.client.verifyTypedData({ address: e.signer, ...td, signature: e.signature }).catch(() => false) : false;
  };

  const entrySchema = z.strictObject({
    seq: z.number().int().min(0),
    prevHash: hex(64),
    hash: hex(64),
    actor: z.enum(["supplier_agent", "buyer_agent"]),
    invoiceRef: z.string().max(80),
    reasonCode: z.string().max(60).optional(),
    at: z.number().int().min(0),
    snapshot: z.unknown(),
    proposal: z.unknown(),
    outcome: z.enum(["auto_apply", "needs_approval", "rejected"]),
    reason: z.string().max(2000),
    signer: address,
    signature: hex(),
  });

  app.use("/api/log/ingest", limited(120));
  app.post("/api/log/ingest", async (c) => {
    if (config.AGENTS.length === 0 || !config.INVOICE_BOOK) return unavailable(c, "the decision log is not switched on", "Set AGENT_WALLETS and INVOICE_BOOK_ADDRESS.");
    const { entries } = await body(c, z.object({ entries: z.array(entrySchema).min(1).max(100) }));
    // Check everything before storing anything: an agent we do not know, a hash that is not the entry's hash, a signature that is not the agent's.
    for (const e of entries) {
      if (!config.AGENTS.includes(e.signer)) return fail(c, "UNKNOWN_AGENT", "That wallet is not one of this deployment's agents.", 403);
      // The log is public. A private policy value in a snapshot or proposal is refused, whatever the agent meant (defence in depth).
      const leaked = findPrivateKey(e.snapshot) ?? findPrivateKey(e.proposal);
      if (leaked) return fail(c, "PRIVATE_VALUE", `Entry ${e.seq} contains "${leaked}", a private policy value. Private values are committed to, never logged.`, 422);
      const recomputed = hashDecision({ prevHash: e.prevHash, actor: e.actor, snapshot: e.snapshot ?? null, proposal: e.proposal ?? null, outcome: e.outcome, reason: e.reason });
      if (recomputed !== e.hash) return fail(c, "BAD_HASH", `Entry ${e.seq} does not hash to the value sent.`, 422);
      if (!(await attestationOk(e))) return fail(c, "BAD_SIGNATURE", `Entry ${e.seq} is not signed by ${e.signer}.`, 422);
    }
    let stored = 0;
    try {
      await db.tx(async (t) => {
        for (const e of entries) {
          const same = await t.query<{ hash: string }>("select hash from decisions where signer = $1 and seq = $2", [e.signer, e.seq]);
          if (same.length) {
            if (same[0]!.hash !== e.hash) throw Object.assign(new Error(`Entry ${e.seq} of ${e.signer} differs from the one already stored.`), { code: "FORK" });
            continue; // already stored: delivering again is harmless
          }
          const last = await t.query<{ seq: string; hash: string }>("select seq::text as seq, hash from decisions where signer = $1 order by seq desc limit 1", [e.signer]);
          const wantSeq = last.length ? Number(last[0]!.seq) + 1 : 0;
          const wantPrev = last.length ? last[0]!.hash : GENESIS_HASH;
          if (e.seq !== wantSeq || e.prevHash !== wantPrev) throw Object.assign(new Error(`Entry ${e.seq} does not continue the chain: expected entry ${wantSeq}.`), { code: "GAP" });
          await t.query(
            `insert into decisions (actor, snapshot_json, proposal_json, outcome, reason_code, reason, prev_hash, hash, signature, signer, seq, invoice_ref, agent_at)
             values ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [e.actor, JSON.stringify(e.snapshot ?? null), JSON.stringify(e.proposal ?? null), e.outcome, e.reasonCode ?? null, e.reason, e.prevHash, e.hash, e.signature, e.signer, e.seq, e.invoiceRef, e.at],
          );
          stored++;
        }
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "FORK" || code === "GAP") return fail(c, code === "FORK" ? "LOG_FORK" : "LOG_GAP", (err as Error).message, 409);
      throw err;
    }
    return ok(c, { received: entries.length, stored }, 201);
  });

  /** The public log: newest first, each entry with its proof. An entry that settled an invoice also names the on-chain transaction that carries its hash. */
  app.get("/api/log", async (c) => {
    const q = z
      .object({ invoice: z.string().max(80).optional(), signer: address.optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })
      .parse(c.req.query());
    const where: string[] = ["signer is not null"];
    const args: unknown[] = [];
    if (q.invoice) (args.push(q.invoice.toLowerCase()), where.push(`lower(invoice_ref) = $${args.length}`));
    if (q.signer) (args.push(q.signer), where.push(`signer = $${args.length}`));
    const total = Number((await db.query<{ n: string }>(`select count(*)::text as n from decisions where ${where.join(" and ")}`, args))[0]!.n);
    const rows = await db.query<LogRow & { invoice_ref: string; reason_code: string | null; agent_at: string }>(
      `select prev_hash, actor::text as actor, snapshot_json, proposal_json, outcome::text as outcome, reason, reason_code, hash, signer, seq::text as seq, signature, invoice_ref, agent_at::text as agent_at
       from decisions where ${where.join(" and ")} order by agent_at desc, seq desc limit ${q.limit} offset ${q.offset}`,
      args,
    );
    const onChain = rows.length
      ? await db.query<{ dh: string; tx_hash: string; block: string }>(
          "select payload_json->>'decisionHash' as dh, tx_hash, block::text as block from chain_events where name = 'EarlySettled' and payload_json->>'decisionHash' = any($1::text[])",
          [rows.map((r) => r.hash)],
        )
      : [];
    const settled = new Map(onChain.map((e) => [e.dh.toLowerCase(), e]));
    return ok(c, {
      total,
      items: rows.map((r) => ({
        seq: Number(r.seq),
        actor: r.actor,
        signer: r.signer,
        invoiceRef: r.invoice_ref,
        outcome: r.outcome,
        reasonCode: r.reason_code,
        reason: r.reason,
        at: Number(r.agent_at),
        hash: r.hash,
        prevHash: r.prev_hash,
        signature: r.signature,
        /** From the snapshot, so a page need not parse it: the version of the policy the decision ran under, and the decision. */
        policyVersion: (r.snapshot_json as { policyVersion?: string } | null)?.policyVersion ?? null,
        result: (r.snapshot_json as { result?: { code?: string } } | null)?.result?.code ?? null,
        snapshot: r.snapshot_json,
        proposal: r.proposal_json,
        settlement: settled.get(r.hash.toLowerCase()) ? { txHash: settled.get(r.hash.toLowerCase())!.tx_hash, block: settled.get(r.hash.toLowerCase())!.block } : null,
      })),
    });
  });

  /** Recompute every agent's chain from the stored rows and re-check every signature. Nothing here trusts what was checked at ingest. */
  app.get("/api/log/verify", async (c) => {
    const rows = await db.query<LogRow>(
      "select prev_hash, actor::text as actor, snapshot_json, proposal_json, outcome::text as outcome, reason, hash, signer, seq::text as seq, signature from decisions where signer is not null order by signer, seq",
    );
    const bySigner = new Map<string, LogRow[]>();
    for (const r of rows) bySigner.set(r.signer, [...(bySigner.get(r.signer) ?? []), r]);
    const agents = [];
    for (const [signer, list] of bySigner) {
      const chain = verifyChain(list.map((x) => ({ prevHash: x.prev_hash as Hex, actor: x.actor, snapshot: x.snapshot_json, proposal: x.proposal_json, outcome: x.outcome, reason: x.reason, hash: x.hash as Hex })));
      const contiguous = list.every((x, i) => Number(x.seq) === i);
      let signaturesOk = true;
      for (const x of list) {
        if (!(await attestationOk({ signer: signer as Address, signature: x.signature as Hex, hash: x.hash as Hex, prevHash: x.prev_hash as Hex, actor: x.actor, seq: Number(x.seq) }))) {
          signaturesOk = false;
          break;
        }
      }
      agents.push({ signer, actor: list[0]!.actor, count: list.length, chainOk: chain.ok && contiguous, badIndex: chain.ok ? (contiguous ? null : list.findIndex((x, i) => Number(x.seq) !== i)) : chain.badIndex, signaturesOk, ok: chain.ok && contiguous && signaturesOk });
    }
    return ok(c, { ok: agents.every((a) => a.ok), count: rows.length, agents, known: config.AGENTS });
  });

  app.get("/api/agents", async (c) => {
    const rows = await db.query(
      "select id, role::text as role, wallet_address, wallet_mode::text as wallet_mode, erc8004_agent_id, a2a_card_url from agents order by created_at",
    );
    return ok(c, rows);
  });

  // ------------------------------------------------------------------------------------------------ relay: registerInvoice for a supplier

  const registerBody = z.object({
    invoice: z.object({ supplier: address, buyer: address, token: address, amount: minor, dueDate: z.string().regex(/^\d{1,12}$/), refHash: hex(64), nonce: z.string().regex(/^\d{1,40}$/) }),
    signature: hex(),
  });

  app.post("/api/relay/register", async (c) => {
    const a = need(c, "supplier");
    if (!d.relayer || !d.client || !config.INVOICE_BOOK) return unavailable(c, "the relayer is not configured", "Set RELAYER_PRIVATE_KEY, ARC_RPC_URL and INVOICE_BOOK_ADDRESS, or register the invoice from your own wallet.");
    const { invoice, signature } = await body(c, registerBody);
    if (invoice.supplier !== a.address) return fail(c, "NOT_YOUR_INVOICE", "You can only register invoices where your linked wallet is the supplier.", 403);
    if (invoice.supplier === invoice.buyer) return fail(c, "BAD_REQUEST", "Supplier and buyer must differ.", 400);

    const dom = domain(config.ARC_CHAIN_ID, config.INVOICE_BOOK);
    const msg = { ...invoice, amount: BigInt(invoice.amount), dueDate: BigInt(invoice.dueDate), nonce: BigInt(invoice.nonce) };
    const td = invoiceTypedData(dom, msg);
    let valid = false;
    try {
      valid = (await recoverTypedDataAddress({ ...td, signature })).toLowerCase() === invoice.supplier;
    } catch {
      /* may be a contract wallet */
    }
    if (!valid) valid = await d.client.verifyTypedData({ address: invoice.supplier, ...td, signature }).catch(() => false);
    if (!valid) return fail(c, "BAD_SIGNATURE", "The signature does not match this invoice and your wallet.", 400);

    const id = invoiceId(dom, msg);
    const chain = await d.client.readContract({ address: config.INVOICE_BOOK, abi: INVOICE_BOOK_ABI, functionName: "invoices", args: [id] });
    if (chain[6] !== 0) return ok(c, { invoiceId: id, alreadyRegistered: true });

    // Credit extended (SRS FR-05): if the supplier has set a limit for this buyer, a new invoice that would take what the buyer owes past it
    // is not registered for them. The supplier decides the limit; the server only applies it. No limit set means no check.
    const pol = await exposurePolicyOf(a.orgId!);
    if (pol.configured) {
      const events = toInvoiceEvents(exposureEvents(await indexed(), { side: "supplier", owner: invoice.supplier, counterparty: invoice.buyer }, await blockTimes(db)));
      const decision = evaluateExposure({
        side: "supplier",
        nowSec: BigInt(Math.floor((d.now?.() ?? new Date()).getTime() / 1000)),
        newExposure: BigInt(invoice.amount),
        events,
        policy: { version: pol.version, newCounterpartyLimit: pol.newCounterpartyLimit, maxLimit: pol.maxLimit, growthBps: pol.growthBps, lookbackDays: pol.lookbackDays, graceSeconds: pol.graceSeconds },
      });
      if (decision.kind === "decided" && !decision.ok) {
        return fail(c, "EXPOSURE_LIMIT", `This invoice would take what this buyer owes you past the limit you set (${pol.version}). Raise the limit on the Credit limits page, or wait for earlier invoices to be paid.`, 409);
      }
    }

    const payload: RegisterPayload = { invoice: { ...invoice }, signature, invoiceId: id };
    const { job, created } = await enqueue(db, { kind: "register_invoice", key: `register:${id}`, payload, accountId: a.id });
    return ok(c, { invoiceId: id, jobId: job.id, status: job.status, created }, 202);
  });

  app.get("/api/jobs/:id", async (c) => {
    const a = need(c);
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/.test(id)) return fail(c, "NOT_FOUND", "No such job.", 404);
    const job = await getJob(db, id);
    const owner = job ? (await db.query<{ account_id: string | null }>("select account_id from jobs where id = $1", [id]))[0]?.account_id : null;
    if (!job || owner !== a.id) return fail(c, "NOT_FOUND", "No such job.", 404);
    return ok(c, { id: job.id, kind: job.kind, status: job.status, attempts: job.attempts, error: job.lastError, result: job.result });
  });

  /**
   * A signed read for an agent process. The agent proves it controls its wallet (EIP-712 AgentRead over the path and a time),
   * and the API answers with that wallet's own business data only. This is how the buyer agent gets its payment calendar
   * without a browser session. Every value here is declared by the owner, so it is labelled declared.
   */
  const READ_WINDOW_SEC = 120;
  const agentCaller = async (c: Context, resource: string, opts: { linked?: boolean } = {}): Promise<{ orgId: string; wallet: Address } | Response> => {
    if (config.AGENTS.length === 0 || !config.INVOICE_BOOK) return unavailable(c, "agent reads are not switched on", "Set AGENT_WALLETS and INVOICE_BOOK_ADDRESS.");
    const wallet = (c.req.header("x-agent-wallet") ?? "").toLowerCase() as Address;
    const ts = Number(c.req.header("x-agent-ts"));
    const signature = (c.req.header("x-agent-sig") ?? "") as Hex;
    if (!config.AGENTS.includes(wallet)) return fail(c, "UNKNOWN_AGENT", "That wallet is not one of this deployment's agents.", 403);
    if (!Number.isInteger(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > READ_WINDOW_SEC) return fail(c, "STALE_REQUEST", "The signed request is too old or too new.", 401);
    const td = agentReadTypedData(domain(config.ARC_CHAIN_ID, config.INVOICE_BOOK), { resource, ts });
    let signedByAgent = false;
    try {
      signedByAgent = (await recoverTypedDataAddress({ ...td, signature })).toLowerCase() === wallet;
    } catch {
      /* may be a contract wallet */
    }
    if (!signedByAgent && d.client) signedByAgent = await d.client.verifyTypedData({ address: wallet, ...td, signature }).catch(() => false);
    if (!signedByAgent) return fail(c, "BAD_SIGNATURE", "The request is not signed by that agent.", 401);
    // Linking is the one call an agent may make before it is linked: it is how it becomes linked.
    if (opts.linked === false) return { orgId: "", wallet };
    const org = await db.query<{ org_id: string }>("select org_id::text as org_id from wallets where address = $1 and purpose = 'agent'", [wallet]);
    if (!org.length) return fail(c, "NOT_LINKED", "That agent wallet is not linked to a business.", 403);
    return { orgId: org[0].org_id, wallet };
  };

  // ------------------------------------------------------------------------------------------------ linking an agent wallet to a business

  const LINK_MINUTES = 15;
  const codeHash = (code: string) => createHash("sha256").update(code.toUpperCase().replace(/[^A-Z2-7]/g, "")).digest("hex");

  /** The owner asks for a one-time code. It is shown once, works once, and expires in minutes. */
  app.post("/api/me/agent-link", async (c) => {
    const a = need(c);
    if (!a.side || !a.orgId) return fail(c, "SIDE_REQUIRED", "Choose supplier or buyer first.", 409);
    // Base32 letters only, so it is easy to read out and type: three groups of four.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bytes = randomBytes(12);
    const code = [0, 4, 8].map((i) => [...bytes.subarray(i, i + 4)].map((b) => alphabet[b % 32]).join("")).join("-");
    const expires = new Date((d.now?.() ?? new Date()).getTime() + LINK_MINUTES * 60_000);
    await db.query("insert into agent_link_codes (code_hash, org_id, expires_at) values ($1, $2, $3)", [codeHash(code), a.orgId, expires]);
    return ok(c, { code, expiresAt: expires.toISOString(), minutes: LINK_MINUTES });
  });

  /** The agent wallets linked to the signed-in business. */
  app.get("/api/me/agent", async (c) => {
    const a = need(c);
    if (!a.orgId) return ok(c, { linked: [] });
    const r = await db.query<{ address: string }>("select address from wallets where org_id = $1 and purpose = 'agent' order by created_at", [a.orgId]);
    return ok(c, { linked: r.map((x) => x.address) });
  });

  /**
   * The agent redeems the code. The request is signed by the agent wallet over this exact path, which includes the code, so the
   * signature cannot be replayed for another code or route. The wallet must be one of this deployment's configured agents.
   */
  app.use("/api/agent/link/*", limited(20));
  app.post("/api/agent/link/:code", async (c) => {
    const code = c.req.param("code");
    const who = await agentCaller(c, `/api/agent/link/${code}`, { linked: false });
    if (who instanceof Response) return who;
    const used = await db.tx(async (t) => {
      const row = await t.query<{ org_id: string }>(
        "update agent_link_codes set used_at = now() where code_hash = $1 and used_at is null and expires_at > $2 returning org_id::text as org_id",
        [codeHash(code), d.now?.() ?? new Date()],
      );
      if (!row.length) return "bad" as const;
      const existing = await t.query<{ org_id: string }>("select org_id::text as org_id from wallets where address = $1", [who.wallet]);
      if (existing.length) return existing[0]!.org_id === row[0]!.org_id ? ("ok" as const) : ("taken" as const);
      await t.query("insert into wallets (org_id, address, purpose, mode) values ($1, $2, 'agent', 'agent')", [row[0]!.org_id, who.wallet]);
      return "ok" as const;
    });
    if (used === "bad") return fail(c, "BAD_CODE", "That link code is wrong, already used, or has expired. Make a new one.", 400);
    if (used === "taken") return fail(c, "ALREADY_LINKED", "This agent wallet is already linked to another business.", 409);
    return ok(c, { linked: true });
  });

  app.use("/api/agent/*", limited(120));

  // NOTE (privacy): there is deliberately no route here for a buyer's hurdle, liquidity floor, caps or payment calendar, nor for a supplier's
  // cost of waiting. Those private values stay with the owning agent (an encrypted local store). Migration 008 drops their old tables.
  // ------------------------------------------------------------------------------------------------ credit and exposure policy (SRS FR-05)

  const exposureBody = z
    .object({ newCounterpartyLimit: minor, maxLimit: minor, growthBps: z.number().int().min(0).max(10_000), lookbackDays: z.number().int().min(1).max(730), graceSeconds: z.number().int().min(0).max(2_592_000) })
    .refine((p) => BigInt(p.maxLimit) >= BigInt(p.newCounterpartyLimit), { message: "The maximum limit cannot be lower than the limit for a new counterparty.", path: ["maxLimit"] });
  type ExposureRow = { version: number; new_counterparty_limit: string; max_limit: string; growth_bps: number; lookback_days: number; grace_seconds: number };
  const exposurePolicyOf = async (orgId: string) => {
    const r = await db.query<ExposureRow>(
      "select version, new_counterparty_limit::text as new_counterparty_limit, max_limit::text as max_limit, growth_bps, lookback_days, grace_seconds from exposure_policies where org_id = $1",
      [orgId],
    );
    const p = r[0];
    // No row means the owner has not set one. That is reported as not configured; it is never filled with a favourable default.
    if (!p) return { configured: false as const };
    return { configured: true as const, version: `exposure-${p.version}`, newCounterpartyLimit: fromNumeric(p.new_counterparty_limit), maxLimit: fromNumeric(p.max_limit), growthBps: p.growth_bps, lookbackDays: p.lookback_days, graceSeconds: p.grace_seconds };
  };

  app.get("/api/exposure-policy", async (c) => {
    const a = need(c);
    if (!a.side || !a.orgId) return fail(c, "SIDE_REQUIRED", "Choose supplier or buyer first.", 409);
    return ok(c, { side: a.side, ...(await exposurePolicyOf(a.orgId)) });
  });

  /** Saving a changed policy makes a new version and keeps the old one. Saving the same numbers again changes nothing. */
  app.put("/api/exposure-policy", async (c) => {
    const a = need(c);
    if (!a.side || !a.orgId) return fail(c, "SIDE_REQUIRED", "Choose supplier or buyer first.", 409);
    const p = await body(c, exposureBody);
    const args = [a.orgId, toNumeric(BigInt(p.newCounterpartyLimit)), toNumeric(BigInt(p.maxLimit)), p.growthBps, p.lookbackDays, p.graceSeconds];
    await db.tx(async (t) => {
      const cur = await t.query<ExposureRow>(
        "select version, new_counterparty_limit::text as new_counterparty_limit, max_limit::text as max_limit, growth_bps, lookback_days, grace_seconds from exposure_policies where org_id = $1 for update",
        [a.orgId],
      );
      const same = cur[0] && fromNumeric(cur[0].new_counterparty_limit) === BigInt(p.newCounterpartyLimit) && fromNumeric(cur[0].max_limit) === BigInt(p.maxLimit) && cur[0].growth_bps === p.growthBps && cur[0].lookback_days === p.lookbackDays && cur[0].grace_seconds === p.graceSeconds;
      if (same) return;
      const version = cur[0] ? cur[0].version + 1 : 1;
      await t.query(
        `insert into exposure_policies (org_id, version, new_counterparty_limit, max_limit, growth_bps, lookback_days, grace_seconds) values ($1, ${version}, $2, $3, $4, $5, $6)
         on conflict (org_id) do update set version = excluded.version, new_counterparty_limit = excluded.new_counterparty_limit, max_limit = excluded.max_limit, growth_bps = excluded.growth_bps, lookback_days = excluded.lookback_days, grace_seconds = excluded.grace_seconds, updated_at = now()`,
        args,
      );
      await t.query("insert into exposure_policy_versions (org_id, version, new_counterparty_limit, max_limit, growth_bps, lookback_days, grace_seconds) values ($1, $2, $3, $4, $5, $6, $7)", [a.orgId, version, ...args.slice(1)]);
    });
    return ok(c, { side: a.side, ...(await exposurePolicyOf(a.orgId)) });
  });

  /** The agent reads the policy its owner set, proved by its wallet. */
  app.get("/api/agent/exposure-policy", async (c) => {
    const who = await agentCaller(c, "/api/agent/exposure-policy");
    if (who instanceof Response) return who;
    return ok(c, await exposurePolicyOf(who.orgId));
  });

  // ------------------------------------------------------------------------------------------------ claim links (spec 8.15)
  //
  // A buyer invites a supplier to be paid early without any account: the link is a bearer secret (only its SHA-256 is
  // stored). The supplier opens it, sees plain terms and the payout address that is already fixed on-chain, and signs an
  // EarlyPayOffer with that wallet. Nothing is paid until the buyer reviews and settles, so a forwarded link can only ever
  // lead to a payment to the invoice's own supplier address, which a stranger cannot change.

  const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
  const TOKEN = /^[A-Za-z0-9_-]{22}$/;
  const origin = () => config.ORIGINS[0] ?? "";

  interface OfferRow {
    id: string;
    chain_invoice_id: string;
    rate_bps: number;
    expiry: Date;
    status: "open" | "claimed" | "expired" | "withdrawn";
    supplier_address: string;
    claimed_at: Date | null;
    signed_offer: unknown;
    created_at: Date;
  }
  const OFFER_COLS = "id, chain_invoice_id, rate_bps, expiry, status::text as status, supplier_address, claimed_at, signed_offer, created_at";

  const createBody = z.object({ invoiceId: hex(64), rateBps: z.number().int().min(0).max(5000), validHours: z.number().int().min(1).max(168).default(72) });

  app.post("/api/standing-offers", async (c) => {
    const a = need(c, "buyer");
    const b = await body(c, createBody);
    const id = b.invoiceId.toLowerCase();
    const inv = (await indexed()).find((i) => i.id === id);
    if (!inv) return fail(c, "NOT_FOUND", "That invoice is not in the index yet. Wait a moment and try again.", 404);
    if (inv.buyer !== a.address) return fail(c, "NOT_YOUR_INVOICE", "Only the buyer named on the invoice can invite the supplier.", 403);
    if (inv.status !== "approved") return fail(c, "NOT_APPROVED", "Approve the invoice first. Only approved invoices can be paid early.", 409);
    const nowMs = now().getTime();
    const expiry = new Date(Math.min(nowMs + b.validHours * 3_600_000, Number(inv.dueDate) * 1000 - 60_000));
    if (expiry.getTime() <= nowMs + 60_000) return fail(c, "TOO_LATE", "The invoice is due too soon to leave an offer open.", 409);
    const open = await db.query("select id from standing_offers where chain_invoice_id = $1 and status = 'open' and expiry > $2", [id, now().toISOString()]);
    if (open.length) return fail(c, "OPEN_LINK_EXISTS", "There is already an open claim link for this invoice. Withdraw it first to make a new one.", 409);

    const token = randomBytes(16).toString("base64url");
    const row = await db.query<{ id: string }>(
      "insert into standing_offers (chain_invoice_id, rate_bps, expiry, claim_token_hash, created_by, supplier_address) values ($1,$2,$3,$4,$5,$6) returning id",
      [id, b.rateBps, expiry.toISOString(), hashToken(token), a.id, inv.supplier],
    );
    // The only time the token is ever shown. It is not stored and not logged.
    return ok(c, { id: row[0]!.id, token, claimUrl: `${origin()}/claim/${token}`, expiresAt: expiry }, 201);
  });

  app.get("/api/standing-offers", async (c) => {
    const a = need(c, "buyer");
    const rows = await db.query<OfferRow>(`select ${OFFER_COLS} from standing_offers where created_by = $1 order by created_at desc`, [a.id]);
    const t = now().getTime();
    return ok(c, rows.map((r) => ({ id: r.id, invoiceId: r.chain_invoice_id, rateBps: r.rate_bps, expiresAt: r.expiry, status: r.status === "open" && new Date(r.expiry).getTime() <= t ? "expired" : r.status, supplier: r.supplier_address, claimedAt: r.claimed_at, signedOffer: r.signed_offer })));
  });

  app.delete("/api/standing-offers/:id", async (c) => {
    const a = need(c, "buyer");
    const r = await db.query("update standing_offers set status = 'withdrawn' where id::text = $1 and created_by = $2 and status = 'open' returning id", [c.req.param("id"), a.id]);
    return r.length ? ok(c, { withdrawn: true }) : fail(c, "NOT_FOUND", "No open claim link with that id.", 404);
  });

  const byToken = async (token: string) => {
    if (!TOKEN.test(token)) return null;
    const r = await db.query<OfferRow>(`select ${OFFER_COLS} from standing_offers where claim_token_hash = $1`, [hashToken(token)]);
    return r[0] ?? null;
  };

  /** What the supplier sees before signing anything: the terms, and where the money will go. Nothing here is a secret. */
  app.get("/api/claims/:token", async (c) => {
    const row = await byToken(c.req.param("token"));
    if (!row) return fail(c, "NOT_FOUND", "This claim link is not valid.", 404);
    const t = now();
    const expired = new Date(row.expiry).getTime() <= t.getTime();
    if (row.status !== "open" || expired) return ok(c, { status: row.status === "open" ? "expired" : row.status });
    const inv = (await indexed()).find((i) => i.id === row.chain_invoice_id);
    if (!inv || inv.status !== "approved") return ok(c, { status: "unavailable", reason: "The invoice is no longer waiting for payment." });
    return ok(c, {
      status: "open",
      now: Math.floor(t.getTime() / 1000),
      invoice: { id: inv.id, amount: inv.amount, dueDate: inv.dueDate, buyer: inv.buyer, supplier: inv.supplier },
      offer: { rateBps: row.rate_bps, expiresAt: row.expiry },
      chain: { id: config.ARC_CHAIN_ID, book: config.INVOICE_BOOK ?? null },
    });
  });

  const acceptBody = z.object({
    offer: z.object({ invoiceId: hex(64), rateBps: z.number().int().min(0).max(5000), expiry: z.string().regex(/^\d{1,12}$/), nonce: z.string().regex(/^\d{1,40}$/) }),
    signature: hex(),
  });

  app.post("/api/claims/:token/accept", async (c) => {
    if (!d.client || !config.INVOICE_BOOK) return unavailable(c, "the chain is not connected to the server", "Try again later.");
    const row = await byToken(c.req.param("token"));
    if (!row) return fail(c, "NOT_FOUND", "This claim link is not valid.", 404);
    const t = now();
    if (row.status !== "open" || new Date(row.expiry).getTime() <= t.getTime()) return fail(c, "NOT_OPEN", "This offer is no longer open.", 409);
    const inv = (await indexed()).find((i) => i.id === row.chain_invoice_id);
    if (!inv || inv.status !== "approved") return fail(c, "NOT_OPEN", "The invoice is no longer waiting for payment.", 409);

    const { offer, signature } = await body(c, acceptBody);
    if (offer.invoiceId.toLowerCase() !== inv.id) return fail(c, "OFFER_MISMATCH", "That offer is for a different invoice.", 400);
    if (offer.rateBps !== row.rate_bps) return fail(c, "OFFER_MISMATCH", "The signed rate is not the rate on the link.", 400);
    const expirySec = BigInt(offer.expiry);
    if (expirySec * 1000n > BigInt(new Date(row.expiry).getTime()) || expirySec <= BigInt(Math.floor(t.getTime() / 1000))) {
      return fail(c, "OFFER_MISMATCH", "The offer must expire no later than the link does, and in the future.", 400);
    }

    // Only the invoice's own supplier address can sign for it, so a forwarded link cannot redirect the payout.
    const dom = domain(config.ARC_CHAIN_ID, config.INVOICE_BOOK);
    const td = offerTypedData(dom, { invoiceId: inv.id, rateBps: offer.rateBps, expiry: expirySec, nonce: BigInt(offer.nonce) });
    let valid = false;
    try {
      valid = (await recoverTypedDataAddress({ ...td, signature })).toLowerCase() === inv.supplier;
    } catch {
      /* may be a contract wallet */
    }
    if (!valid) valid = await d.client.verifyTypedData({ address: inv.supplier, ...td, signature }).catch(() => false);
    if (!valid) return fail(c, "BAD_SIGNATURE", `The signature is not from ${inv.supplier}, the wallet this invoice pays.`, 400);
    const used = await d.client.readContract({ address: config.INVOICE_BOOK, abi: INVOICE_BOOK_ABI, functionName: "usedOfferNonce", args: [inv.supplier, BigInt(offer.nonce)] });
    if (used) return fail(c, "NONCE_USED", "That offer number was already used. Sign again.", 409);

    const code = { v: 1, chainId: config.ARC_CHAIN_ID, book: config.INVOICE_BOOK, supplier: inv.supplier, offer: { invoiceId: inv.id, rateBps: offer.rateBps, expiry: offer.expiry, nonce: offer.nonce }, sig: signature };
    // One winner: the update only succeeds while the offer is still open, so two people racing cannot both claim it.
    const won = await db.query("update standing_offers set status = 'claimed', claimed_at = $2, signed_offer = $3::jsonb where id = $1 and status = 'open' returning id", [row.id, t.toISOString(), JSON.stringify(code)]);
    if (!won.length) return fail(c, "NOT_OPEN", "This offer was just claimed.", 409);
    return ok(c, { claimed: true });
  });

  app.post("/api/claims/:token/decline", async (c) => {
    const row = await byToken(c.req.param("token"));
    if (!row) return fail(c, "NOT_FOUND", "This claim link is not valid.", 404);
    await db.query("update standing_offers set status = 'withdrawn', declined_at = $2 where id = $1 and status = 'open'", [row.id, now().toISOString()]);
    return ok(c, { declined: true });
  });

  // ------------------------------------------------------------------------------------------------ not built yet: say so, never fake

  for (const [method, path, what] of [
    ["post", "/api/rounds", "early-pay rounds (Tier 3)"],
    ["get", "/api/buyer/plan", "the server-side allocator (the plan is computed in the app and by the buyer agent)"],
  ] as const) {
    app[method](path, (c) => fail(c, "NOT_IMPLEMENTED", `Not built yet: ${what}.`, 501));
  }

  return app;
}

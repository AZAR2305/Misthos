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
  bindWallet,
  chooseSide,
  createChallenge,
  consumeGoogleNonce,
  createSession,
  destroySession,
  issueGoogleNonce,
  stepOf,
  upsertGoogleAccount,
  verifyWalletMessage,
  type Account,
  type GoogleVerifier,
} from "./auth";
import type { Config } from "./config";
import type { Db } from "./db";
import { blockTimes, getCursor, loadInvoices, type IndexerStatus } from "./indexer";
import { enqueue, getJob } from "./jobs";
import type { Relayer, RegisterPayload } from "./relayer";
import { rateLimit } from "./ratelimit";
import { fromNumeric, ser, toNumeric } from "./serialize";
import { INVOICE_BOOK_ABI, balanced, domain, invoiceId, invoiceTypedData, offerTypedData, journalFrom, settlementRows, summarise, toBeancount, toCsv, verifyChain, type InvoiceRecord, type StoredDecision } from "./shared";

export interface AppDeps {
  config: Config;
  db: Db;
  /** Chain reads. Without it the API says "chain unavailable" rather than guessing. */
  client?: PublicClient;
  google?: GoogleVerifier;
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
  const me = (a: Account) => ({ id: a.id, email: a.email, name: a.name, side: a.side, address: a.address, addressBoundAt: a.addressBoundAt, step: stepOf(a) });

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
      google: { configured: !!d.google },
      relayer: { configured: !!d.relayer },
      dataSource: config.DATA_SOURCE,
    });
  });

  // ------------------------------------------------------------------------------------------------ sign-in and account

  /** The page asks for a one-time nonce, hands it to Google, and the signed token comes back carrying it. */
  app.get("/api/auth/nonce", async (c) => {
    if (!d.google) return unavailable(c, "Google sign-in is not configured", "Set GOOGLE_CLIENT_ID on the server.");
    return ok(c, await issueGoogleNonce(db, now()));
  });

  app.post("/api/auth/google", async (c) => {
    if (!d.google) return unavailable(c, "Google sign-in is not configured", "Set GOOGLE_CLIENT_ID on the server.");
    const { credential } = await body(c, z.object({ credential: z.string().min(20) }));
    const profile = await d.google(credential);
    await consumeGoogleNonce(db, profile.nonce, now());
    const account = await upsertGoogleAccount(db, profile);
    const s = await createSession(db, account.id, config.SESSION_TTL_DAYS, now());
    setCookie(c, COOKIE, s.token, { httpOnly: true, sameSite: "Lax", secure: config.COOKIE_SECURE === "true", path: "/", expires: s.expiresAt });
    return ok(c, me(account));
  });

  app.post("/api/auth/logout", async (c) => {
    await destroySession(db, getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: "/" });
    return ok(c, { signedOut: true });
  });

  app.get("/api/me", (c) => {
    const a = c.get("account");
    return ok(c, a ? me(a) : null);
  });

  app.post("/api/auth/wallet/challenge", async (c) => {
    const a = need(c);
    const { address: addr } = await body(c, z.object({ address }));
    // The site the message names is the page that asked, so a signature collected on a look-alike site is worthless here.
    const site = c.req.header("origin") && config.ORIGINS.includes(c.req.header("origin")!) ? c.req.header("origin")! : (config.ORIGINS[0] ?? "unknown");
    return ok(c, await createChallenge(db, a, addr, config.ARC_CHAIN_ID, site, now()));
  });

  app.post("/api/auth/wallet/bind", async (c) => {
    const a = need(c);
    const b = await body(c, z.object({ address, nonce: z.string().min(8), signature: hex() }));
    const updated = await bindWallet(db, a, b, (message, signature, addr) => verifyWalletMessage({ client: d.client, address: addr, message, signature }), now());
    return ok(c, me(updated));
  });

  app.put("/api/me/side", async (c) => {
    const a = need(c);
    const b = await body(c, z.object({ side: z.enum(["supplier", "buyer"]), confirm: z.boolean().default(false) }));
    return ok(c, me(await chooseSide(db, a, b.side, b.confirm)));
  });

  // ------------------------------------------------------------------------------------------------ public reads from the index

  const indexed = async (): Promise<InvoiceRecord[]> => loadInvoices(db);

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

  app.get("/api/log/verify", async (c) => {
    const rows = await db.query<{ prev_hash: string; actor: StoredDecision["actor"]; snapshot_json: unknown; proposal_json: unknown; outcome: StoredDecision["outcome"]; reason: string; hash: string }>(
      "select prev_hash, actor, snapshot_json, proposal_json, outcome, reason, hash from decisions order by created_at, id",
    );
    const r = verifyChain(rows.map((x) => ({ prevHash: x.prev_hash as Hex, actor: x.actor, snapshot: x.snapshot_json, proposal: x.proposal_json, outcome: x.outcome, reason: x.reason, hash: x.hash as Hex })));
    return ok(c, { count: rows.length, ...r });
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

  // ------------------------------------------------------------------------------------------------ private settings (per account)

  const bps = z.number().int().min(0).max(5000);
  const policyBody = z.object({ hurdleAprBps: bps, liquidityFloor: minor, perInvoiceCap: minor, dailyCap: minor, humanAbove: minor });

  app.get("/api/policy", async (c) => {
    const a = need(c, "buyer");
    const r = await db.query<Record<string, string | number>>(
      `select hurdle_apr_bps, liquidity_floor::text as liquidity_floor, per_invoice_cap::text as per_invoice_cap, daily_cap::text as daily_cap, human_above::text as human_above
       from policies where buyer_org = $1`,
      [a.orgId],
    );
    const p = r[0];
    return ok(c, p ? { hurdleAprBps: p.hurdle_apr_bps, liquidityFloor: fromNumeric(String(p.liquidity_floor)), perInvoiceCap: fromNumeric(String(p.per_invoice_cap)), dailyCap: fromNumeric(String(p.daily_cap)), humanAbove: fromNumeric(String(p.human_above)) } : null);
  });

  /** Stores the private policy. The on-chain caps are set by the buyer's own wallet (setLimits); this never sends a transaction. */
  app.put("/api/policy", async (c) => {
    const a = need(c, "buyer");
    const p = await body(c, policyBody);
    await db.query(
      `insert into policies (buyer_org, hurdle_apr_bps, liquidity_floor, per_invoice_cap, daily_cap, human_above) values ($1,$2,$3,$4,$5,$6)
       on conflict (buyer_org) do update set hurdle_apr_bps = excluded.hurdle_apr_bps, liquidity_floor = excluded.liquidity_floor,
         per_invoice_cap = excluded.per_invoice_cap, daily_cap = excluded.daily_cap, human_above = excluded.human_above`,
      [a.orgId, p.hurdleAprBps, toNumeric(BigInt(p.liquidityFloor)), toNumeric(BigInt(p.perInvoiceCap)), toNumeric(BigInt(p.dailyCap)), toNumeric(BigInt(p.humanAbove))],
    );
    return ok(c, p);
  });

  const obligationBody = z.object({ label: z.string().min(1).max(120), amount: minor.refine((s) => BigInt(s) > 0n, "must be above zero"), dueDate: z.iso.datetime(), kind: z.enum(["payroll", "bill", "other"]).default("other") });
  app.get("/api/obligations", async (c) => {
    const a = need(c, "buyer");
    const r = await db.query<{ id: string; label: string; amount: string; due_date: Date; kind: string }>(
      "select id, label, amount::text as amount, due_date, kind::text as kind from obligations where buyer_org = $1 order by due_date",
      [a.orgId],
    );
    return ok(c, r.map((x) => ({ id: x.id, label: x.label, amount: fromNumeric(x.amount), dueDate: new Date(x.due_date).toISOString(), kind: x.kind })));
  });
  app.post("/api/obligations", async (c) => {
    const a = need(c, "buyer");
    const b = await body(c, obligationBody);
    const r = await db.query<{ id: string }>("insert into obligations (buyer_org, label, amount, due_date, kind) values ($1,$2,$3,$4,$5) returning id", [a.orgId, b.label, toNumeric(BigInt(b.amount)), b.dueDate, b.kind]);
    return ok(c, { id: r[0]!.id, ...b }, 201);
  });
  app.delete("/api/obligations/:id", async (c) => {
    const a = need(c, "buyer");
    const r = await db.query("delete from obligations where id::text = $1 and buyer_org = $2 returning id", [c.req.param("id"), a.orgId]);
    return r.length ? ok(c, { deleted: true }) : fail(c, "NOT_FOUND", "No such obligation.", 404);
  });

  const prefsBody = z.object({ costOfWaitingAprBps: bps.max(5000), maxRateBps: bps, startRateBps: bps, stepBps: z.number().int().min(1).max(5000) });
  app.get("/api/prefs", async (c) => {
    const a = need(c, "supplier");
    const r = await db.query<{ cost_of_waiting_apr_bps: number; max_rate_bps: number; start_rate_bps: number; step_bps: number }>(
      "select cost_of_waiting_apr_bps, max_rate_bps, start_rate_bps, step_bps from supplier_prefs where supplier_org = $1",
      [a.orgId],
    );
    const p = r[0];
    return ok(c, p ? { costOfWaitingAprBps: p.cost_of_waiting_apr_bps, maxRateBps: p.max_rate_bps, startRateBps: p.start_rate_bps, stepBps: p.step_bps } : null);
  });
  app.put("/api/prefs", async (c) => {
    const a = need(c, "supplier");
    const p = await body(c, prefsBody);
    await db.query(
      `insert into supplier_prefs (supplier_org, cost_of_waiting_apr_bps, max_rate_bps, start_rate_bps, step_bps) values ($1,$2,$3,$4,$5)
       on conflict (supplier_org) do update set cost_of_waiting_apr_bps = excluded.cost_of_waiting_apr_bps, max_rate_bps = excluded.max_rate_bps,
         start_rate_bps = excluded.start_rate_bps, step_bps = excluded.step_bps`,
      [a.orgId, p.costOfWaitingAprBps, p.maxRateBps, p.startRateBps, p.stepBps],
    );
    return ok(c, p);
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

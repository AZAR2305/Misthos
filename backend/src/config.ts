import { z } from "zod";

/**
 * Everything the backend reads from the environment, validated once at boot. Secrets (RELAYER_PRIVATE_KEY, DATABASE_URL
 * passwords) are never logged or returned by the API. A missing optional value switches its feature to "unavailable"
 * (see /api/health); it never switches to a fake.
 */
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an address");
const optional = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === "" ? undefined : v), s.optional());

const schema = z.object({
  PORT: z.coerce.number().int().default(4000),
  /** postgres://user:pass@host/db, or pglite://memory, or pglite://./path (an embedded Postgres in a folder). */
  DATABASE_URL: z.string().default("pglite://./.data/misthos"),
  ARC_RPC_URL: optional(z.string().url()),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  INVOICE_BOOK_ADDRESS: optional(address),
  USDC_ADDRESS: optional(address),
  DEPLOY_BLOCK: z.coerce.bigint().default(0n),
  /** How many blocks behind the head to index. Arc has deterministic finality, so 0 is fine there. */
  CONFIRMATIONS: z.coerce.bigint().default(0n),
  INDEXER_POLL_MS: z.coerce.number().int().default(2000),
  /** Browser origins allowed to call the API with cookies, comma separated. */
  FRONTEND_ORIGINS: z.string().default(""),
  /** The agent wallets whose signed decision logs this API accepts (comma separated 0x addresses). Empty: the log is off. */
  AGENT_WALLETS: z.string().default(""),
  /** Requests per minute per client on /api/auth/* and /api/claims/*. */
  /** Most invoices one supplier address may ask the relayer to register in an hour. Gas is paid by the relayer, so this bounds what one address can cost. */
  REGISTER_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(10),
  /** The relayer's native balance (18 decimals) below which /api/health warns. Default 0.05 USDC. */
  RELAYER_MIN_BALANCE_WEI: z.coerce.bigint().default(50_000_000_000_000_000n),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
  /** Set to true behind a proxy that sets X-Forwarded-For, so the limiter sees the real client. */
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  SESSION_TTL_DAYS: z.coerce.number().int().default(14),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  /** Pays gas to submit registerInvoice for suppliers. It never holds user funds. Optional. */
  RELAYER_PRIVATE_KEY: optional(z.string().regex(/^0x[0-9a-fA-F]{64}$/, "not a 32-byte hex key")),
  /** What the public stats call this data (spec 6: stats show pilot by default). Honest default: sandbox. */
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const p = schema.safeParse(env);
  if (!p.success) {
    const lines = p.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid backend configuration:\n${lines}`);
  }
  const c = p.data;
  return {
    ...c,
    ORIGINS: c.FRONTEND_ORIGINS.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
    AGENTS: c.AGENT_WALLETS.split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^0x[0-9a-f]{40}$/.test(s)) as `0x${string}`[],
    INVOICE_BOOK: c.INVOICE_BOOK_ADDRESS?.toLowerCase() as `0x${string}` | undefined,
  };
}

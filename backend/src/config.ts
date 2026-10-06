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
  /** Google sign-in. Without a client id, /api/auth/google answers "unavailable". */
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_ISSUERS: z.string().default("https://accounts.google.com,accounts.google.com"),
  GOOGLE_JWKS_URL: z.string().url().default("https://www.googleapis.com/oauth2/v3/certs"),
  /** Browser origins allowed to call the API with cookies, comma separated. */
  FRONTEND_ORIGINS: z.string().default("http://localhost:3000"),
  SESSION_TTL_DAYS: z.coerce.number().int().default(14),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  /** Pays gas to submit registerInvoice for suppliers. It never holds user funds. Optional. */
  RELAYER_PRIVATE_KEY: optional(z.string().regex(/^0x[0-9a-fA-F]{64}$/, "not a 32-byte hex key")),
  /** What the public stats call this data (spec 6: stats show pilot by default). Honest default: sandbox. */
  DATA_SOURCE: z.enum(["pilot", "sandbox"]).default("sandbox"),
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
    ISSUERS: c.GOOGLE_ISSUERS.split(",").map((s) => s.trim()).filter(Boolean),
    ORIGINS: c.FRONTEND_ORIGINS.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
    INVOICE_BOOK: c.INVOICE_BOOK_ADDRESS?.toLowerCase() as `0x${string}` | undefined,
  };
}

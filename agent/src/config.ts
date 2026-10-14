import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/** Environment for the agent processes. Secrets come from agent/.env (gitignored); see .env.example. */
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x address");
const optionalAddr = z.preprocess((v) => (v === "" ? undefined : v), addr.optional());
const optionalText = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const envSchema = z.object({
  ARC_RPC_URL: z.url(),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  USDC_ADDRESS: addr.default("0x3600000000000000000000000000000000000000"),
  INVOICE_BOOK_ADDRESS: optionalAddr,
  SUPPLIER_AGENT_WALLET_ADDRESS: optionalAddr,
  BUYER_AGENT_WALLET_ADDRESS: optionalAddr,
  /** Where the other side's agent can be reached. The supplier agent needs BUYER_AGENT_URL; there is no default address. */
  BUYER_AGENT_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  SUPPLIER_AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(4101),
  BUYER_AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(4102),
  /** The Misthos API that receives the signed decision log. Without it the log stays on this machine. */
  BACKEND_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  /** Where this agent keeps its decision log between restarts. */
  AGENT_DATA_DIR: z.string().default(".agent-data"),
  /** Separate Circle CLI login folders, one per agent (CIRCLE_CLI_HOME). */
  SUPPLIER_CIRCLE_CLI_HOME: optionalText,
  BUYER_CIRCLE_CLI_HOME: optionalText,
  ANTHROPIC_API_KEY: optionalText,
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  /** Which model service proposes strategy. Code still decides everything; there is no fallback between providers. */
  /** 32 random bytes (openssl rand -base64 32). Encrypts the private files this agent keeps: policy records, decision preimages and, for the buyer, the payment calendar. */
  AGENT_STORE_KEY: optionalText,
  MODEL_PROVIDER: z.enum(["anthropic", "groq"]).default("anthropic"),
  GROQ_API_KEY: optionalText,
  /** a Groq model id (listed by /models on 14 Oct 2026) that follows strict JSON instructions; check https://console.groq.com/docs/models. */
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  /** ERC-8004 on Arc testnet (confirmed 14 Oct 2026). The ids are minted when each agent registers (scripts/erc8004-register.ts). */
  ERC8004_IDENTITY: z.string().default("0x8004A818BFB912233c491871b3d84c89A494BD9e"),
  ERC8004_REPUTATION: z.string().default("0x8004B663056A597Dffe9eCcC1965A193B7388713"),
  SUPPLIER_ERC8004_ID: optionalText,
  BUYER_ERC8004_ID: optionalText,
  LADDER_RUNG_SECONDS: z.coerce.number().int().positive().default(900),
});
export type AgentConfig = z.infer<typeof envSchema>;

export function loadEnvFile(path = resolve(process.cwd(), ".env")): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid agent environment:\n${lines.join("\n")}\nSee agent/.env.example.`);
  }
  return parsed.data;
}

// ---- private per-agent configuration ----------------------------------------------------------------------------
import { DEFAULT_FEE_BPS, DEFAULT_PREFS, toMinor, type BuyerPolicy, type SupplierPrefs } from "./core/index.js";

const bps = (v: string | undefined, fallback: number) => (v === undefined || v === "" ? fallback : z.coerce.number().int().min(0).max(10_000).parse(v));
const usdc = (v: string | undefined, fallback: bigint) => (v === undefined || v === "" ? fallback : toMinor(v));

/** SUPPLIER_*: the supplier's own private bounds (spec 6 supplier_prefs). */
export function supplierPrefsFromEnv(env: NodeJS.ProcessEnv = process.env): SupplierPrefs {
  return {
    costOfWaitingAprBps: bps(env.SUPPLIER_COST_OF_WAITING_APR_BPS, DEFAULT_PREFS.costOfWaitingAprBps),
    maxRateBps: bps(env.SUPPLIER_MAX_RATE_BPS, DEFAULT_PREFS.maxRateBps),
    startRateBps: bps(env.SUPPLIER_START_RATE_BPS, DEFAULT_PREFS.startRateBps),
    stepBps: bps(env.SUPPLIER_STEP_BPS, DEFAULT_PREFS.stepBps),
  };
}

/** BUYER_*: the buyer's private policy (spec 6 policies). The hurdle never leaves the buyer process. */
export function buyerPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): BuyerPolicy {
  return {
    hurdleAprBps: bps(env.BUYER_HURDLE_APR_BPS, 0),
    liquidityFloor: usdc(env.BUYER_LIQUIDITY_FLOOR, 0n),
    perInvoiceCap: usdc(env.BUYER_PER_INVOICE_CAP, 0n),
    dailyCap: usdc(env.BUYER_DAILY_CAP, 0n),
    humanAbove: usdc(env.BUYER_HUMAN_ABOVE, 0n),
    feeBps: bps(env.FEE_BPS, DEFAULT_FEE_BPS),
  };
}

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
  SUPPLIER_AGENT_URL: z.url().default("http://localhost:4101"),
  BUYER_AGENT_URL: z.url().default("http://localhost:4102"),
  ANTHROPIC_API_KEY: optionalText,
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
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

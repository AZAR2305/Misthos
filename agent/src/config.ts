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

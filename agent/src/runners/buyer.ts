import { createPublicClient, http } from "viem";
import { z } from "zod";
import { domain } from "../core/index.js";
import { BuyerAgent } from "../agents/buyer.js";
import { AnthropicModel } from "../agents/model.js";
import { viemChainReader } from "../agents/chain.js";
import { DecisionStore } from "../agents/store.js";
import { offerMsgSchema } from "../protocol/index.js";
import { buyerPolicyFromEnv, loadConfig, loadEnvFile } from "../config.js";
import { CircleCliAdapter } from "../wallets/circleCli.js";
import { chainVerifier, type Address } from "../wallets/types.js";
import { serve, type ServeOptions } from "./http.js";

/**
 * The buyer agent process (CLAUDE.md 5.3 and 9.2). Routes: GET /health, POST /negotiate, POST /accept/:invoiceId,
 * POST /plan, POST /plan/execute, GET /needs-approval, GET /decisions. The hurdle and policy stay in this process.
 */
loadEnvFile();
/** Local by default; the website origin is allowed to call the agent from the browser. Read after .env is loaded. */
const serveOptions: ServeOptions = {
  host: process.env.AGENT_HOST || undefined,
  allowedOrigins: (process.env.AGENT_ALLOWED_ORIGINS ?? "http://localhost:3000").split(","),
};
const cfg = loadConfig();
if (!cfg.BUYER_AGENT_WALLET_ADDRESS || !cfg.INVOICE_BOOK_ADDRESS) {
  throw new Error("Set BUYER_AGENT_WALLET_ADDRESS and INVOICE_BOOK_ADDRESS in agent/.env (run: pnpm doctor).");
}
const book = cfg.INVOICE_BOOK_ADDRESS as Address;
const publicClient = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });
const verifier = chainVerifier(publicClient);

const wallet = new CircleCliAdapter({
  address: cfg.BUYER_AGENT_WALLET_ADDRESS as Address,
  cliHome: cfg.BUYER_CIRCLE_CLI_HOME,
  rpcUrl: cfg.ARC_RPC_URL,
  usdc: cfg.USDC_ADDRESS as Address,
  verifier,
});
const store = new DecisionStore();
const buyer = new BuyerAgent({
  wallet,
  domain: domain(cfg.ARC_CHAIN_ID, book),
  model: new AnthropicModel({ apiKey: cfg.ANTHROPIC_API_KEY ?? "", model: cfg.ANTHROPIC_MODEL }),
  policy: buyerPolicyFromEnv(),
  store,
  chain: viemChainReader(cfg.ARC_RPC_URL, book),
  invoiceBook: book,
  verifier,
});

const obligationSchema = z.strictObject({
  id: z.string().max(80),
  dueSec: z.string().regex(/^\d+$/),
  amount: z.string().regex(/^\d+$/),
});
const planSchema = z.strictObject({
  /** Override for the treasury balance in minor units; default is the wallet's real USDC balance. */
  cash: z.string().regex(/^\d+$/).optional(),
  obligations: z.array(obligationSchema).max(100).default([]),
  spentToday: z.string().regex(/^\d+$/).optional(),
});

const runPlan = async (body: unknown) => {
  const p = planSchema.parse(body ?? {});
  const cash = p.cash !== undefined ? BigInt(p.cash) : await wallet.balance("USDC");
  const obligations = p.obligations.map((o) => ({ id: o.id, dueSec: BigInt(o.dueSec), amount: BigInt(o.amount) }));
  return buyer.plan(cash, obligations, p.spentToday ? BigInt(p.spentToday) : 0n);
};

serve(
  Number(new URL(cfg.BUYER_AGENT_URL).port || 4102),
  {
    "GET /health": async () => ({ wallet: await wallet.health(), modelConfigured: !!cfg.ANTHROPIC_API_KEY, invoiceBook: book }),
    "POST /negotiate": async ({ body }) => buyer.handleOffer(offerMsgSchema.parse(body)),
    "POST /accept/:invoiceId": async ({ params }) => buyer.acceptHeld(z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(params.invoiceId).toLowerCase()),
    "POST /plan": async ({ body }) => runPlan(body),
    "POST /plan/execute": async ({ body }) => {
      const { allocation } = await runPlan(body);
      return { allocation, settled: await buyer.executePlan(allocation) };
    },
    "GET /policy": async () => buyerPolicyFromEnv(), // private to this machine: the hurdle is shown only to its owner
    "GET /needs-approval": async () => [...buyer.needsApproval].map(([invoiceId, v]) => ({ invoiceId, ...v })),
    "GET /decisions": async () => ({ entries: store.all(), verify: store.verify() }),
  },
  "buyer-agent",
  serveOptions,
);

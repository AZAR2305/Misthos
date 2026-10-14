import { createPublicClient, http } from "viem";
import { z } from "zod";
import { domain } from "../core/index.js";
import { BuyerAgent } from "../agents/buyer.js";
import { createModel, modelKeyOf } from "../agents/modelFactory.js";
import { viemChainReader } from "../agents/chain.js";
import { openDecisionStore } from "../agents/log.js";
import { fetchExposureEvents, fetchExposurePolicy, fetchObligations, fetchPayables, linkAgent, signedReader } from "../agents/backend.js";
import { offerMsgSchema } from "../protocol/index.js";
import { buyerPolicyFromEnv, loadConfig, loadEnvFile } from "../config.js";
import { CircleCliAdapter } from "../wallets/circleCli.js";
import { readReputation, reputationClient, writeSettlementFeedback } from "../identity/erc8004.js";
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
  openRoutes: ["GET /health", "POST /negotiate"],
  controlToken: process.env.AGENT_CONTROL_TOKEN || undefined,
  allowedOrigins: (process.env.AGENT_ALLOWED_ORIGINS ?? "").split(","),
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
const reader = cfg.BACKEND_URL ? signedReader({ backendUrl: cfg.BACKEND_URL, wallet, domain: domain(cfg.ARC_CHAIN_ID, book) }) : undefined;
/** Only an explicit declaration that there are no obligations allows an empty calendar without the API. */
const declaredNone = process.env.BUYER_OBLIGATIONS_DECLARED_NONE === "true";
const obligations = async () => {
  if (reader) return fetchObligations(reader);
  if (declaredNone) return [];
  throw new Error("The payment calendar is unavailable: set BACKEND_URL, or set BUYER_OBLIGATIONS_DECLARED_NONE=true if you have no obligations.");
};
/**
 * What the chain says this buyer owes on approved, unpaid invoices (verified, unlike the calendar the owner typed). Read from the API's
 * indexed events. Without BACKEND_URL there is no verified source, so none is added (and the declared calendar still applies).
 */
const payables = async () => (cfg.BACKEND_URL ? fetchPayables({ backendUrl: cfg.BACKEND_URL, buyer: cfg.BUYER_AGENT_WALLET_ADDRESS! }) : []);
const store = openDecisionStore({ name: "buyer", dataDir: cfg.AGENT_DATA_DIR, wallet, domain: domain(cfg.ARC_CHAIN_ID, book), backendUrl: cfg.BACKEND_URL, policy: { label: "buyer-policy", params: buyerPolicyFromEnv() } });
const buyer = new BuyerAgent({
  wallet,
  domain: domain(cfg.ARC_CHAIN_ID, book),
  model: createModel(cfg),
  policy: buyerPolicyFromEnv(),
  store,
  chain: viemChainReader(cfg.ARC_RPC_URL, book),
  invoiceBook: book,
  verifier,
  // The real USDC balance and the payment calendar the owner declared. A calendar that cannot be read is never assumed empty:
  // the read throws, the buyer fails closed (TREASURY_UNAVAILABLE) and accepts nothing until it can.
  // The credit limit the owner set on the API and the settlement history it rests on. Without BACKEND_URL no limit can be read, so
  // none is applied (and none is claimed). With it, an unreadable limit or history stops acceptance (fail closed).
  exposure:
    reader && cfg.BACKEND_URL
      ? {
          policy: () => fetchExposurePolicy(reader),
          events: (supplier) => fetchExposureEvents({ backendUrl: cfg.BACKEND_URL!, side: "buyer", owner: cfg.BUYER_AGENT_WALLET_ADDRESS!, counterparty: supplier }),
        }
      : undefined,
  // After a settlement, rate the supplier's ERC-8004 agent (owners cannot rate their own agents, so each side rates the other). Best effort.
  onSettled: (invoiceId) =>
    void writeSettlementFeedback({ wallet, reputation: cfg.ERC8004_REPUTATION as Address, counterpartyAgentId: cfg.SUPPLIER_ERC8004_ID ? BigInt(cfg.SUPPLIER_ERC8004_ID) : undefined, log: (m) => console.log(`[buyer-agent] ${m}`) }, invoiceId),
  treasury: async () => ({ cash: await wallet.balance("USDC"), obligations: [...(await obligations()), ...(await payables())] }),
});

const obligationSchema = z.strictObject({
  id: z.string().max(80),
  dueSec: z.string().regex(/^\d+$/),
  amount: z.string().regex(/^\d+$/),
});
const planSchema = z.strictObject({
  /** Override for the treasury balance in minor units; default is the wallet's real USDC balance. */
  cash: z.string().regex(/^\d+$/).optional(),
  /** Omit to use the calendar the owner declared on the API. */
  obligations: z.array(obligationSchema).max(100).optional(),
  spentToday: z.string().regex(/^\d+$/).optional(),
});

const runPlan = async (body: unknown) => {
  const p = planSchema.parse(body ?? {});
  const cash = p.cash !== undefined ? BigInt(p.cash) : await wallet.balance("USDC");
  const calendar = p.obligations ? p.obligations.map((o) => ({ id: o.id, dueSec: BigInt(o.dueSec), amount: BigInt(o.amount) })) : await obligations();
  return buyer.plan(cash, calendar, p.spentToday ? BigInt(p.spentToday) : 0n);
};

serve(
  cfg.BUYER_AGENT_PORT,
  {
    "GET /health": async () => ({ wallet: await wallet.health(), modelConfigured: !!modelKeyOf(cfg), invoiceBook: book }),
    "POST /negotiate": async ({ body }) => buyer.handleOffer(offerMsgSchema.parse(body)),
    "POST /accept/:invoiceId": async ({ params }) => buyer.acceptHeld(z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(params.invoiceId).toLowerCase()),
    "POST /plan": async ({ body }) => runPlan(body),
    "POST /plan/execute": async ({ body }) => {
      const { allocation } = await runPlan(body);
      return { allocation, settled: await buyer.executePlan(allocation) };
    },
    "GET /range/:invoiceId": async ({ params }) => buyer.range(z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(params.invoiceId).toLowerCase() as `0x${string}`),
    "GET /reputation": async () => ({ supplierAgentId: cfg.SUPPLIER_ERC8004_ID ?? null, summary: cfg.SUPPLIER_ERC8004_ID ? await readReputation(reputationClient(cfg.ARC_RPC_URL), cfg.ERC8004_REPUTATION as Address, BigInt(cfg.SUPPLIER_ERC8004_ID), [cfg.BUYER_AGENT_WALLET_ADDRESS as Address]) ?? null : null }),
    "GET /policy": async () => buyerPolicyFromEnv(), // private to this machine: the hurdle is shown only to its owner
    "GET /needs-approval": async () => [...buyer.needsApproval].map(([invoiceId, v]) => ({ invoiceId, ...v })),
    "GET /decisions": async () => ({ entries: store.all(), verify: store.verify(), delivery: { ...store.status(), backend: !!cfg.BACKEND_URL } }),
  },
  "buyer-agent",
  serveOptions,
);

// One-time link: the owner makes a code on the website (Credit limits page) and starts this agent once with MISTHOS_LINK_CODE set.
// The agent redeems it with a request signed by its own wallet, which links this wallet to the business so it can read its own data.
if (process.env.MISTHOS_LINK_CODE && cfg.BACKEND_URL) {
  void linkAgent({ backendUrl: cfg.BACKEND_URL, wallet, domain: domain(cfg.ARC_CHAIN_ID, book), code: process.env.MISTHOS_LINK_CODE }).then((r) =>
    console.log(r.ok ? "[buyer-agent] linked to your business. You can remove MISTHOS_LINK_CODE now." : `[buyer-agent] could not link: ${r.message}`),
  );
}

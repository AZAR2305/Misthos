import { createPublicClient, http } from "viem";
import { z } from "zod";
import { domain } from "../core/index.js";
import { createModel, modelKeyOf } from "../agents/modelFactory.js";
import { SupplierAgent, httpTransport } from "../agents/supplier.js";
import { viemChainReader } from "../agents/chain.js";
import { fetchExposureEvents, fetchExposurePolicy, linkAgent, signedReader } from "../agents/backend.js";
import { openDecisionStore } from "../agents/log.js";
import { loadConfig, loadEnvFile, supplierPrefsFromEnv } from "../config.js";
import { CircleCliAdapter } from "../wallets/circleCli.js";
import { readReputation, reputationClient, writeSettlementFeedback } from "../identity/erc8004.js";
import { chainVerifier, WalletError, type Address } from "../wallets/types.js";
import { ProtocolError } from "../agents/buyer.js";
import { vaultFromEnv } from "../agents/vault.js";
import { serve, type ServeOptions } from "./http.js";

/**
 * The supplier agent process (CLAUDE.md 5.3 and 9.2). Its own wallet, its own private config; it talks to the buyer
 * agent only over HTTP and to the chain. Routes: GET /health, POST /start/:invoiceId, POST /pause/:invoiceId.
 */
loadEnvFile();
/** Local by default; the website origin is allowed to call the agent from the browser. Read after .env is loaded. */
const serveOptions: ServeOptions = {
  host: process.env.AGENT_HOST || undefined,
  openRoutes: ["GET /health"],
  controlToken: process.env.AGENT_CONTROL_TOKEN || undefined,
  allowedOrigins: (process.env.AGENT_ALLOWED_ORIGINS ?? "").split(","),
};
const cfg = loadConfig();
if (!cfg.SUPPLIER_AGENT_WALLET_ADDRESS || !cfg.BUYER_AGENT_WALLET_ADDRESS || !cfg.INVOICE_BOOK_ADDRESS) {
  throw new Error("Set SUPPLIER_AGENT_WALLET_ADDRESS, BUYER_AGENT_WALLET_ADDRESS and INVOICE_BOOK_ADDRESS in agent/.env (run: pnpm doctor).");
}
if (!cfg.BUYER_AGENT_URL) throw new Error("Set BUYER_AGENT_URL in agent/.env: the address where the buyer agent can be reached (run: pnpm doctor).");
const book = cfg.INVOICE_BOOK_ADDRESS as Address;
const publicClient = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });
const verifier = chainVerifier(publicClient);

const wallet = new CircleCliAdapter({
  address: cfg.SUPPLIER_AGENT_WALLET_ADDRESS as Address,
  cliHome: cfg.SUPPLIER_CIRCLE_CLI_HOME,
  rpcUrl: cfg.ARC_RPC_URL,
  usdc: cfg.USDC_ADDRESS as Address,
  verifier,
});
const chain = viemChainReader(cfg.ARC_RPC_URL, book);
const vault = vaultFromEnv(cfg.AGENT_STORE_KEY);
const store = openDecisionStore({ vault, name: "supplier", dataDir: cfg.AGENT_DATA_DIR, wallet, domain: domain(cfg.ARC_CHAIN_ID, book), backendUrl: cfg.BACKEND_URL, policy: { label: "supplier-policy", params: supplierPrefsFromEnv() } });
// The supplier's history with a buyer and its own credit limit come from the API. Without BACKEND_URL it starts at its configured rate.
const reader = cfg.BACKEND_URL ? signedReader({ backendUrl: cfg.BACKEND_URL, wallet, domain: domain(cfg.ARC_CHAIN_ID, book) }) : undefined;
const exposure =
  reader && cfg.BACKEND_URL
    ? {
        policy: () => fetchExposurePolicy(reader),
        events: (buyer: Address) => fetchExposureEvents({ backendUrl: cfg.BACKEND_URL!, side: "supplier", owner: cfg.SUPPLIER_AGENT_WALLET_ADDRESS!, counterparty: buyer }),
      }
    : undefined;
const paused = new Set<string>();
const agents = new Map<string, SupplierAgent>();

const agentFor = (invoiceId: string) => {
  const a = new SupplierAgent({
    wallet,
    domain: domain(cfg.ARC_CHAIN_ID, book),
    model: createModel(cfg),
    prefs: supplierPrefsFromEnv(),
    store,
    transport: httpTransport(cfg.BUYER_AGENT_URL!),
    buyerAgent: cfg.BUYER_AGENT_WALLET_ADDRESS as Address,
    verifier,
    rungSeconds: cfg.LADDER_RUNG_SECONDS,
    waitWindowSeconds: 120, // the same as httpTransport's timeout
    shouldStop: (id) => paused.has(id),
    exposure,
  });
  agents.set(invoiceId, a);
  return a;
};

const idSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

serve(
  cfg.SUPPLIER_AGENT_PORT,
  {
    "GET /health": async () => {
      const w = await wallet.health();
      return { wallet: w, modelConfigured: !!modelKeyOf(cfg), invoiceBook: book };
    },
    "POST /start/:invoiceId": async ({ params }) => {
      const id = idSchema.parse(params.invoiceId) as `0x${string}`;
      const inv = await chain.invoice(id);
      if (!inv) throw new ProtocolError("NOT_FOUND", "That invoice is not registered on chain.");
      if (inv.supplier.toLowerCase() !== (await wallet.address()).toLowerCase()) {
        throw new ProtocolError("SUPPLIER_MISMATCH", "This agent's wallet is not the invoice's supplier.");
      }
      paused.delete(id);
      const agent = agentFor(id);
      const result = await agent.start({
        id,
        face: inv.amount,
        dueSec: inv.dueDate,
        status: inv.status === "approved" ? "approved" : inv.status === "registered" ? "registered" : inv.status === "disputed" ? "disputed" : "settled",
        pastAcceptedBps: [], // filled by the agent from proven settlements with this buyer when it can read history
        buyer: inv.buyer,
      });
      // After a settlement the chain confirms, rate the buyer's ERC-8004 agent (best effort, never blocks the reply).
      if (result.kind === "accepted") {
        void (async () => {
          const settled = await chain.invoice(id);
          if (settled?.status === "settled_early" || settled?.status === "settled_due") {
            await writeSettlementFeedback({ wallet, reputation: cfg.ERC8004_REPUTATION as Address, counterpartyAgentId: cfg.BUYER_ERC8004_ID ? BigInt(cfg.BUYER_ERC8004_ID) : undefined, log: (m) => console.log(`[supplier-agent] ${m}`) }, id);
          }
        })().catch(() => undefined);
      }
      return { result, transcript: agent.transcript };
    },
    "POST /pause/:invoiceId": async ({ params }) => {
      paused.add(idSchema.parse(params.invoiceId));
      return { paused: true };
    },
    "GET /reputation": async () => ({ buyerAgentId: cfg.BUYER_ERC8004_ID ?? null, summary: cfg.BUYER_ERC8004_ID ? await readReputation(reputationClient(cfg.ARC_RPC_URL), cfg.ERC8004_REPUTATION as Address, BigInt(cfg.BUYER_ERC8004_ID), [cfg.SUPPLIER_AGENT_WALLET_ADDRESS as Address]) ?? null : null }),
    "GET /prefs": async () => supplierPrefsFromEnv(),
    "GET /range/:invoiceId": async ({ params }) => {
      const id = idSchema.parse(params.invoiceId) as `0x${string}`;
      const inv = await chain.invoice(id);
      if (!inv || inv.supplier.toLowerCase() !== (await wallet.address()).toLowerCase()) throw new ProtocolError("NOT_FOUND", "That invoice is not yours as supplier.");
      return (agents.get(id) ?? agentFor(id)).range({ face: inv.amount, dueSec: inv.dueDate });
    },
    "GET /decisions": async () => ({ entries: store.all(), verify: store.verify(), delivery: { ...store.status(), backend: !!cfg.BACKEND_URL } }),
  },
  "supplier-agent",
  serveOptions,
);

// One-time link: the owner makes a code on the website (Credit limits page) and starts this agent once with MISTHOS_LINK_CODE set.
// The agent redeems it with a request signed by its own wallet, which links this wallet to the business so it can read its own data.
if (process.env.MISTHOS_LINK_CODE && cfg.BACKEND_URL) {
  void linkAgent({ backendUrl: cfg.BACKEND_URL, wallet, domain: domain(cfg.ARC_CHAIN_ID, book), code: process.env.MISTHOS_LINK_CODE }).then((r) =>
    console.log(r.ok ? "[supplier-agent] linked to your business. You can remove MISTHOS_LINK_CODE now." : `[supplier-agent] could not link: ${r.message}`),
  );
}

process.on("unhandledRejection", (e) => {
  if (e instanceof WalletError) console.error(`[supplier-agent] ${e.code}: ${e.message}`);
  else console.error("[supplier-agent] unhandled rejection", (e as Error)?.message);
});

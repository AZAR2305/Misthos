import { createPublicClient, http } from "viem";
import { z } from "zod";
import { domain } from "../core/index.js";
import { AnthropicModel } from "../agents/model.js";
import { SupplierAgent, httpTransport } from "../agents/supplier.js";
import { viemChainReader } from "../agents/chain.js";
import { DecisionStore } from "../agents/store.js";
import { loadConfig, loadEnvFile, supplierPrefsFromEnv } from "../config.js";
import { CircleCliAdapter } from "../wallets/circleCli.js";
import { chainVerifier, WalletError, type Address } from "../wallets/types.js";
import { ProtocolError } from "../agents/buyer.js";
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
  allowedOrigins: (process.env.AGENT_ALLOWED_ORIGINS ?? "http://localhost:3000").split(","),
};
const cfg = loadConfig();
if (!cfg.SUPPLIER_AGENT_WALLET_ADDRESS || !cfg.BUYER_AGENT_WALLET_ADDRESS || !cfg.INVOICE_BOOK_ADDRESS) {
  throw new Error("Set SUPPLIER_AGENT_WALLET_ADDRESS, BUYER_AGENT_WALLET_ADDRESS and INVOICE_BOOK_ADDRESS in agent/.env (run: pnpm doctor).");
}
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
const store = new DecisionStore();
const paused = new Set<string>();
const agents = new Map<string, SupplierAgent>();

const agentFor = (invoiceId: string) => {
  const a = new SupplierAgent({
    wallet,
    domain: domain(cfg.ARC_CHAIN_ID, book),
    model: new AnthropicModel({ apiKey: cfg.ANTHROPIC_API_KEY ?? "", model: cfg.ANTHROPIC_MODEL }),
    prefs: supplierPrefsFromEnv(),
    store,
    transport: httpTransport(cfg.BUYER_AGENT_URL),
    buyerAgent: cfg.BUYER_AGENT_WALLET_ADDRESS as Address,
    verifier,
    rungSeconds: cfg.LADDER_RUNG_SECONDS,
    shouldStop: (id) => paused.has(id),
  });
  agents.set(invoiceId, a);
  return a;
};

const idSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

serve(
  Number(new URL(cfg.SUPPLIER_AGENT_URL).port || 4101),
  {
    "GET /health": async () => {
      const w = await wallet.health();
      return { wallet: w, modelConfigured: !!cfg.ANTHROPIC_API_KEY, invoiceBook: book };
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
        pastAcceptedBps: [], // from the ledger once the backend exists (agent/ is the process, backend/ owns the history)
      });
      return { result, transcript: agent.transcript };
    },
    "POST /pause/:invoiceId": async ({ params }) => {
      paused.add(idSchema.parse(params.invoiceId));
      return { paused: true };
    },
    "GET /prefs": async () => supplierPrefsFromEnv(),
    "GET /decisions": async () => ({ entries: store.all(), verify: store.verify() }),
  },
  "supplier-agent",
  serveOptions,
);

process.on("unhandledRejection", (e) => {
  if (e instanceof WalletError) console.error(`[supplier-agent] ${e.code}: ${e.message}`);
  else console.error("[supplier-agent] unhandled rejection", (e as Error)?.message);
});

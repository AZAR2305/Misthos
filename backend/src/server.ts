import { serve } from "@hono/node-server";
import { createPublicClient, defineChain, http } from "viem";
import { createApp } from "./api";
import { createGoogleVerifier } from "./auth";
import { loadConfig } from "./config";
import { migrate, openDb } from "./db";
import { startIndexer } from "./indexer";
import { startWorker } from "./jobs";
import { chainHandlers, createViemRelayer } from "./relayer";

/**
 * One process: the HTTP API, the chain indexer and the job worker. Each part that lacks its configuration stays off and
 * says so in /api/health, instead of faking a result. Start with:  pnpm --filter @misthos/backend start
 */
async function main() {
  const config = loadConfig();
  const db = await openDb(config.DATABASE_URL);
  const ran = await migrate(db);
  if (ran.length) console.log(`migrations applied: ${ran.join(", ")}`);

  const chain = defineChain({
    id: config.ARC_CHAIN_ID,
    name: config.ARC_CHAIN_ID === 5042002 ? "Arc Testnet" : `chain ${config.ARC_CHAIN_ID}`,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // native gas is 18-decimal on Arc (spec 5.5)
    rpcUrls: { default: { http: [config.ARC_RPC_URL ?? "http://127.0.0.1:8545"] } },
  });
  const client = config.ARC_RPC_URL ? createPublicClient({ chain, transport: http(config.ARC_RPC_URL), cacheTime: 0 }) : undefined;

  let indexer: ReturnType<typeof startIndexer> | undefined;
  let worker: ReturnType<typeof startWorker> | undefined;
  if (client && config.INVOICE_BOOK) {
    indexer = startIndexer({ db, client, book: config.INVOICE_BOOK, startBlock: config.DEPLOY_BLOCK, confirmations: config.CONFIRMATIONS, pollMs: config.INDEXER_POLL_MS });
  } else {
    console.warn("indexer off: set ARC_RPC_URL and INVOICE_BOOK_ADDRESS");
  }

  const relayer =
    client && config.INVOICE_BOOK && config.RELAYER_PRIVATE_KEY
      ? createViemRelayer({ privateKey: config.RELAYER_PRIVATE_KEY as `0x${string}`, rpcUrl: config.ARC_RPC_URL!, chain, book: config.INVOICE_BOOK, publicClient: client })
      : undefined;
  if (client && config.INVOICE_BOOK) worker = startWorker(db, relayer ? chainHandlers({ relayer, publicClient: client, book: config.INVOICE_BOOK }) : {});
  if (!relayer) console.warn("relayer off: set RELAYER_PRIVATE_KEY to submit registerInvoice for suppliers");

  const google = config.GOOGLE_CLIENT_ID
    ? createGoogleVerifier({ clientId: config.GOOGLE_CLIENT_ID, issuers: config.ISSUERS, jwksUrl: config.GOOGLE_JWKS_URL })
    : undefined;
  if (!google) console.warn("Google sign-in off: set GOOGLE_CLIENT_ID");

  const app = createApp({ config, db, client, google, relayer, indexer });
  const server = serve({ fetch: app.fetch, port: config.PORT }, (i) => console.log(`Misthos API listening on port ${i.port}  (health: /api/health)`));

  const stop = async () => {
    indexer?.stop();
    worker?.stop();
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

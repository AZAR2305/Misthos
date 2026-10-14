// Registers both agents on the ERC-8004 identity registry (if they have no id yet) and, for each invoice id given, has each side rate the other.
//   pnpm exec tsx scripts/erc8004-setup.ts [invoiceId ...]
// Real transactions on Arc testnet through the two Circle Agent Wallets. Ids are written to agent/.env.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, type Hex } from "viem";
import { loadConfig, loadEnvFile } from "../src/config.js";
import { CircleCliAdapter } from "../src/wallets/circleCli.js";
import { chainVerifier, type Address } from "../src/wallets/types.js";
import { agentIdFromRegistration, agentMetadataUri, readReputation, registerCall, writeSettlementFeedback } from "../src/identity/erc8004.js";

loadEnvFile();
const cfg = loadConfig();
const rpc = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });
const verifier = chainVerifier(rpc);
const mk = (who: "SUPPLIER" | "BUYER") =>
  new CircleCliAdapter({ address: cfg[`${who}_AGENT_WALLET_ADDRESS`] as Address, cliHome: cfg[`${who}_CIRCLE_CLI_HOME`], rpcUrl: cfg.ARC_RPC_URL, usdc: cfg.USDC_ADDRESS as Address, verifier });
const wallets = { SUPPLIER: mk("SUPPLIER"), BUYER: mk("BUYER") };
const ids: Record<string, string | undefined> = { SUPPLIER: cfg.SUPPLIER_ERC8004_ID, BUYER: cfg.BUYER_ERC8004_ID };
const envPath = resolve(process.cwd(), ".env");
const setEnv = (k: string, v: string) => {
  let s = readFileSync(envPath, "utf8");
  s = new RegExp(`^${k}=.*$`, "m").test(s) ? s.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : s + `\n${k}=${v}\n`;
  writeFileSync(envPath, s);
};

for (const who of ["SUPPLIER", "BUYER"] as const) {
  if (ids[who]) { console.log(who, "already has ERC-8004 id", ids[who]); continue; }
  const wallet = wallets[who];
  const addr = await wallet.address();
  const uri = agentMetadataUri({ name: `Misthos ${who.toLowerCase()} agent`, role: who === "SUPPLIER" ? "supplier" : "buyer", wallet: addr, chainId: cfg.ARC_CHAIN_ID });
  console.log(who, "registering identity…");
  const r = await wallet.execute(registerCall(cfg.ERC8004_IDENTITY as Address, uri));
  if (!r.txHash) throw new Error("no transaction hash returned");
  const id = await agentIdFromRegistration(rpc as never, cfg.ERC8004_IDENTITY as Address, r.txHash, addr);
  if (id === undefined) throw new Error("registered, but no agent id found in the receipt");
  ids[who] = id.toString();
  setEnv(`${who}_ERC8004_ID`, id.toString());
  console.log(who, "agent id", id.toString(), `https://explorer.testnet.arc.io/tx/${r.txHash}`);
}

for (const invoice of process.argv.slice(2) as Hex[]) {
  const sup = { wallet: wallets.SUPPLIER, reputation: cfg.ERC8004_REPUTATION as Address, counterpartyAgentId: BigInt(ids.BUYER!), log: console.log };
  const buy = { wallet: wallets.BUYER, reputation: cfg.ERC8004_REPUTATION as Address, counterpartyAgentId: BigInt(ids.SUPPLIER!), log: console.log };
  console.log("rating for invoice", invoice);
  await writeSettlementFeedback(sup, invoice);
  await writeSettlementFeedback(buy, invoice);
}

const sAddr = cfg.SUPPLIER_AGENT_WALLET_ADDRESS as Address;
const bAddr = cfg.BUYER_AGENT_WALLET_ADDRESS as Address;
console.log("buyer agent as seen by the supplier:", await readReputation(rpc as never, cfg.ERC8004_REPUTATION as Address, BigInt(ids.BUYER!), [sAddr]));
console.log("supplier agent as seen by the buyer:", await readReputation(rpc as never, cfg.ERC8004_REPUTATION as Address, BigInt(ids.SUPPLIER!), [bAddr]));

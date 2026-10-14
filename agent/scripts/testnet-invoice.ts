// Creates one real invoice on Arc testnet between the two agent wallets, then has the buyer approve it.
//   pnpm exec tsx scripts/testnet-invoice.ts [amountUsdc] [daysToDue]
// The supplier agent wallet signs the invoice (Circle CLI), the backend's relayer key pays gas to register it, and the buyer agent wallet
// approves it (Circle CLI). Prints the invoice id; then start the agents and POST /start/<id> on the supplier agent.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domain, invoiceId, invoiceTypedData } from "../src/core/index.js";
import { loadConfig, loadEnvFile } from "../src/config.js";
import { CircleCliAdapter } from "../src/wallets/circleCli.js";
import { chainVerifier, type Address } from "../src/wallets/types.js";
const REGISTER_ABI = parseAbi([
  "struct Invoice { address supplier; address buyer; address token; uint256 amount; uint64 dueDate; bytes32 refHash; uint256 nonce; }",
  "function registerInvoice(Invoice inv, bytes sig) returns (bytes32 id)",
]);

loadEnvFile();
const cfg = loadConfig();
const amountUsdc = BigInt(process.argv[2] ?? "25");
const days = BigInt(process.argv[3] ?? "30");
const book = cfg.INVOICE_BOOK_ADDRESS as Address;
const rpc = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });
const verifier = chainVerifier(rpc);
const mk = (who: "SUPPLIER" | "BUYER") =>
  new CircleCliAdapter({ address: cfg[`${who}_AGENT_WALLET_ADDRESS`] as Address, cliHome: cfg[`${who}_CIRCLE_CLI_HOME`], rpcUrl: cfg.ARC_RPC_URL, usdc: cfg.USDC_ADDRESS as Address, verifier });
const supplier = mk("SUPPLIER");
const buyer = mk("BUYER");

const relayerKey = readFileSync(resolve(process.cwd(), "../backend/.env"), "utf8").match(/^RELAYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1];
if (!relayerKey) throw new Error("RELAYER_PRIVATE_KEY is not set in backend/.env");

const d = domain(cfg.ARC_CHAIN_ID, book);
const head = await rpc.getBlock();
const inv = {
  supplier: await supplier.address(),
  buyer: await buyer.address(),
  token: cfg.USDC_ADDRESS as Address,
  amount: amountUsdc * 1_000_000n,
  dueDate: head.timestamp + days * 86_400n,
  refHash: keccak256(toHex(`misthos-testnet-${Date.now()}`)) as Hex,
  nonce: BigInt(Date.now()),
};
const id = invoiceId(d, inv);
console.log("invoice id", id);

console.log("1. the supplier agent wallet signs the invoice");
const sig = await supplier.signTypedData(invoiceTypedData(d, inv) as never);

console.log("2. the relayer registers it on chain");
const relayer = privateKeyToAccount(relayerKey as Hex);
const wc = createWalletClient({ account: relayer, transport: http(cfg.ARC_RPC_URL) });
const reg = await wc.writeContract({ address: book, abi: REGISTER_ABI, functionName: "registerInvoice", args: [inv, sig], chain: null, maxFeePerGas: 60_000_000_000n });
const rr = await rpc.waitForTransactionReceipt({ hash: reg });
console.log("   registered:", rr.status, `https://explorer.testnet.arc.io/tx/${reg}`);
if (rr.status !== "success") throw new Error("registration failed");

console.log("3. the buyer agent wallet approves it");
const ap = await buyer.execute({ to: book, abi: "function approveInvoice(bytes32 id)", fn: "approveInvoice", args: [id] });
console.log("   approve result:", ap.txHash ? `https://explorer.testnet.arc.io/tx/${ap.txHash}` : JSON.stringify(ap.raw).slice(0, 200));
console.log("\nINVOICE_ID=" + id);

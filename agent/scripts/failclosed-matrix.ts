// The fail-closed matrix, run against REAL components (not stand-ins): the real Circle CLI, the real Arc RPC and registry, the real Groq API.
//   pnpm exec tsx scripts/failclosed-matrix.ts <approved, unpaid invoice id>
// Each row breaks exactly one dependency and checks that the agent takes no action, says why with a typed code, and (for a session) prints the
// exact fix. No funds move: every row ends before any settlement. It leaves the invoice approved and unpaid.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http, type Hex } from "viem";
import { domain, offerTypedData } from "../src/core/index.js";
import { loadConfig, loadEnvFile } from "../src/config.js";
import { BuyerAgent, DecisionStore, SupplierAgent, guardChain, viemChainReader } from "../src/agents/index.js";
import { GroqModel } from "../src/agents/model.js";
import { createModel } from "../src/agents/modelFactory.js";
import { readRecentReputation } from "../src/identity/erc8004.js";
import { messageSchema, type OfferMsg } from "../src/protocol/index.js";
import { CircleCliAdapter } from "../src/wallets/circleCli.js";
import { chainVerifier, type Address, type ContractCall, type WalletAdapter } from "../src/wallets/types.js";
import { buyerPolicyFromEnv, supplierPrefsFromEnv } from "../src/config.js";

loadEnvFile();
const cfg = loadConfig();
const INVOICE = process.argv[2] as Hex;
if (!/^0x[0-9a-fA-F]{64}$/.test(INVOICE ?? "")) throw new Error("Give an approved, unpaid invoice id.");
const book = cfg.INVOICE_BOOK_ADDRESS as Address;
const D = domain(cfg.ARC_CHAIN_ID, book);
const rpc = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });
const verifier = chainVerifier(rpc);
const adapter = (who: "SUPPLIER" | "BUYER", cliHome?: string) =>
  new CircleCliAdapter({ address: cfg[`${who}_AGENT_WALLET_ADDRESS`] as Address, cliHome: cliHome ?? cfg[`${who}_CIRCLE_CLI_HOME`], rpcUrl: cfg.ARC_RPC_URL, usdc: cfg.USDC_ADDRESS as Address, verifier });
const real = () => Math.floor(Date.now() / 1000);

/** A wallet that counts every contract call, so a row can prove nothing was sent. */
const counting = (w: WalletAdapter) => {
  const calls: ContractCall[] = [];
  return { wallet: { ...w, address: () => w.address(), balance: (t: "USDC" | "EURC") => w.balance(t), signTypedData: (p: never) => w.signTypedData(p), health: () => w.health(), mode: w.mode, execute: async (c: ContractCall) => (calls.push(c), w.execute(c)) } as WalletAdapter, calls };
};

const onchain = await viemChainReader(cfg.ARC_RPC_URL, book).invoice(INVOICE);
if (!onchain || onchain.status !== "approved") throw new Error(`Invoice ${INVOICE} is not registered and approved.`);
const inv = { id: INVOICE, face: onchain.amount, dueSec: onchain.dueDate, status: "approved" as const, pastAcceptedBps: [] as number[], buyer: onchain.buyer };

let failures = 0;
const row = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

/** A real offer, signed by the real supplier agent wallet through the real Circle CLI. */
async function realOffer(): Promise<OfferMsg> {
  const supplier = adapter("SUPPLIER");
  const expiry = BigInt(real() + 900);
  const nonce = BigInt("0x" + [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join(""));
  const offerSig = await supplier.signTypedData(offerTypedData(D, { invoiceId: INVOICE, rateBps: 0, expiry, nonce }) as never);
  return messageSchema.parse(JSON.parse(JSON.stringify({ v: 1, type: "offer", invoiceId: INVOICE, rung: 0, offer: { invoiceId: INVOICE, rateBps: 0, expiry: expiry.toString(), nonce: nonce.toString() }, offerSig, from: await supplier.address(), ts: real() }))) as OfferMsg;
}

// ---- 1. the model is down (a real call to Groq with a key that does not work), after one retry
{
  const supplier = counting(adapter("SUPPLIER"));
  const agent = new SupplierAgent({
    wallet: supplier.wallet, domain: D,
    model: new GroqModel({ apiKey: "gsk_this_key_is_not_valid", model: cfg.GROQ_MODEL, retryDelayMs: 500 }),
    prefs: supplierPrefsFromEnv(), store: new DecisionStore(), buyerAgent: cfg.BUYER_AGENT_WALLET_ADDRESS as Address, verifier,
    rungSeconds: 900, transport: async () => { throw new Error("must not be reached"); },
  });
  const r = await agent.start(inv);
  row("model down after one retry -> needs_approval, MODEL_UNAVAILABLE", r.kind === "needs_approval" && r.reasonCode === "MODEL_UNAVAILABLE" && supplier.calls.length === 0, JSON.stringify(r));
}

// ---- 2. the Circle session expired (a real login folder, logged out through the real CLI)
{
  const copy = mkdtempSync(join(tmpdir(), "misthos-expired-"));
  try {
    cpSync(cfg.SUPPLIER_CIRCLE_CLI_HOME!, copy, { recursive: true });
    execFileSync("pnpm", ["exec", "circle", "wallet", "logout"], { env: { ...process.env, CIRCLE_CLI_HOME: copy }, stdio: "ignore", shell: true });
    const supplier = counting(adapter("SUPPLIER", copy));
    const agent = new SupplierAgent({
      wallet: supplier.wallet, domain: D, model: createModel(cfg), prefs: supplierPrefsFromEnv(), store: new DecisionStore(),
      buyerAgent: cfg.BUYER_AGENT_WALLET_ADDRESS as Address, verifier, rungSeconds: 900, transport: async () => { throw new Error("must not be reached"); },
    });
    const r = await agent.start(inv);
    const ok = r.kind === "needs_approval" && r.reasonCode === "SESSION_EXPIRED" && /CIRCLE_CLI_HOME=/.test(r.reason) && /circle wallet login/.test(r.reason) && supplier.calls.length === 0;
    row("Circle session expired -> SESSION_EXPIRED with the exact re-login command", ok, r.kind === "needs_approval" ? `${r.reasonCode}: ${r.reason}` : JSON.stringify(r));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

// ---- 3. the RPC is unreachable: nothing is read, nothing is sent
{
  const buyer = counting(adapter("BUYER"));
  const agent = new BuyerAgent({
    wallet: buyer.wallet, domain: D, model: createModel(cfg), policy: buyerPolicyFromEnv(), store: new DecisionStore(),
    chain: guardChain(viemChainReader("http://127.0.0.1:9", book)), invoiceBook: book, verifier, treasury: async () => ({ cash: 0n, obligations: [] }),
  });
  let code = "";
  try {
    await agent.handleOffer(await realOffer());
  } catch (e) {
    code = (e as { code?: string }).code ?? "";
  }
  row("RPC unreachable -> chain unavailable, no action", code === "CHAIN_UNAVAILABLE" && buyer.calls.length === 0, `code=${code}, wallet calls=${buyer.calls.length}`);
}

// ---- 4. the registry read fails (a real read against an address that is not the registry)
{
  const buyer = counting(adapter("BUYER"));
  const notARegistry = cfg.BUYER_AGENT_WALLET_ADDRESS as Address; // an account, not a contract: the real RPC answers "no data"
  const store = new DecisionStore();
  const agent = new BuyerAgent({
    wallet: buyer.wallet, domain: D, model: createModel(cfg), policy: buyerPolicyFromEnv(), store, chain: guardChain(viemChainReader(cfg.ARC_RPC_URL, book)), invoiceBook: book, verifier,
    treasury: async () => ({ cash: await buyer.wallet.balance("USDC"), obligations: [] }),
    reputation: () => readRecentReputation(rpc as never, notARegistry, 1n),
  });
  const reply = await agent.handleOffer(await realOffer());
  const held = agent.needsApproval.get(INVOICE);
  row("registry read fails -> needs_approval, REGISTRY_UNAVAILABLE, nothing paid", reply.type === "reject" && held?.reasonCode === "REGISTRY_UNAVAILABLE" && buyer.calls.length === 0, `reply=${reply.type}/${(reply as { reasonCode?: string }).reasonCode}, held=${held?.reasonCode}, wallet calls=${buyer.calls.length}`);
}

console.log(failures === 0 ? "\nFAIL-CLOSED MATRIX PASSED (4 of 4, against real components, run locally)" : `\nFAIL-CLOSED MATRIX: ${failures} row(s) failed`);
process.exit(failures === 0 ? 0 : 1);

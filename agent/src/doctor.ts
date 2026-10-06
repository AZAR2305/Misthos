import { createPublicClient, erc20Abi, http } from "viem";
import { loadConfig, loadEnvFile } from "./config.js";
import { CircleCliAdapter, classifyCliFailure, nodeCliRunner, resolveCliEntry } from "./wallets/circleCli.js";
import { WalletError } from "./wallets/types.js";

/**
 * `pnpm doctor`: checks the real environment the agents need and prints what to fix. Real calls only; nothing is
 * simulated. It never accepts the Circle Terms or logs in for you.
 */
loadEnvFile();
const rows: Array<{ check: string; ok: boolean; detail: string }> = [];
const add = (check: string, ok: boolean, detail: string) => rows.push({ check, ok, detail });

async function main() {
  let cfg: ReturnType<typeof loadConfig> | undefined;
  try {
    cfg = loadConfig();
    add("environment", true, "agent/.env parsed");
  } catch (e) {
    add("environment", false, (e as Error).message);
  }

  // Circle CLI present and usable
  let runner: ReturnType<typeof nodeCliRunner> | undefined;
  try {
    const entry = resolveCliEntry();
    runner = nodeCliRunner(entry);
    const v = await runner(["--version"]);
    add("circle cli", v.exitCode === 0, v.exitCode === 0 ? (v.stdout.trim().split("\n").pop() ?? "installed") : "could not run");
  } catch (e) {
    add("circle cli", false, (e as WalletError).hint ?? (e as Error).message);
  }

  if (runner) {
    const status = await runner(["wallet", "status", "--type", "agent", "--output", "json"]);
    if (status.exitCode === 0) add("circle login (agent)", true, "status returned; confirm the testnet section shows logged in");
    else {
      const err = classifyCliFailure(status);
      add("circle login (agent)", false, `${err.code}: ${err.message}${err.hint ? ` -> ${err.hint}` : ""}`);
    }
  }

  if (cfg) {
    const client = createPublicClient({ transport: http(cfg.ARC_RPC_URL) });
    try {
      const id = await client.getChainId();
      add("arc rpc", id === cfg.ARC_CHAIN_ID, `chain id ${id}${id === cfg.ARC_CHAIN_ID ? "" : ` (expected ${cfg.ARC_CHAIN_ID})`}`);
      const decimals = await client.readContract({ address: cfg.USDC_ADDRESS as `0x${string}`, abi: erc20Abi, functionName: "decimals" });
      add("usdc (erc-20)", decimals === 6, `${cfg.USDC_ADDRESS} decimals ${decimals}`);
      if (cfg.INVOICE_BOOK_ADDRESS) {
        const code = await client.getCode({ address: cfg.INVOICE_BOOK_ADDRESS as `0x${string}` });
        add("invoicebook", !!code && code !== "0x", code && code !== "0x" ? cfg.INVOICE_BOOK_ADDRESS : "no contract code at that address");
      } else add("invoicebook", false, "INVOICE_BOOK_ADDRESS is not set (deploy first: contract/README.md)");
      for (const [name, a] of [["supplier wallet", cfg.SUPPLIER_AGENT_WALLET_ADDRESS], ["buyer wallet", cfg.BUYER_AGENT_WALLET_ADDRESS]] as const) {
        if (!a) {
          add(name, false, "address not set");
          continue;
        }
        const bal = await client.readContract({ address: cfg.USDC_ADDRESS as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [a as `0x${string}`] });
        add(name, true, `${a} USDC balance ${bal} minor units`);
        if (runner) {
          const h = await new CircleCliAdapter({ address: a as `0x${string}`, runner }).health();
          add(`${name} in circle login`, h.ok, h.detail ?? "listed as an agent wallet");
        }
      }
    } catch (e) {
      add("arc rpc", false, `unreachable: ${(e as Error).message.split("\n")[0]}`);
    }
    add("model key", !!cfg.ANTHROPIC_API_KEY, cfg.ANTHROPIC_API_KEY ? `model ${cfg.ANTHROPIC_MODEL}` : "ANTHROPIC_API_KEY is not set (agents fail closed without it)");
  }

  for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.check.padEnd(26)} ${r.detail}`);
  process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
}

void main();

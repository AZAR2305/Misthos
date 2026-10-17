import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { createPublicClient, erc20Abi, http, parseAbiItem, type AbiParameter, type Hex } from "viem";
import { typedDataJson } from "../core/eip712.js";
import {
  WalletError,
  eoaVerifier,
  type Address,
  type ContractCall,
  type Eip712Payload,
  type ExecuteResult,
  type SignatureVerifier,
  type WalletAdapter,
} from "./types.js";

/**
 * Circle Agent Wallet through the Circle CLI (CLAUDE.md 5.6 and 9.3A). Flags below were read from the installed
 * @circle-fin/cli 1.1.4 `--help` output. Two things are still VERIFY: the exact JSON the CLI returns for
 * `wallet sign typed-data` and `wallet execute` (we search the JSON for a signature and a hash instead of assuming
 * field names), and how it encodes tuple arguments.
 *
 * Rules (spec 5.6): one serialized queue, retry with backoff only for RATE_LIMITED, typed errors, and never fall back to
 * another wallet. Terms acceptance is the user's: this adapter never sets CIRCLE_ACCEPT_TERMS.
 */
export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Set when the process could not be started (for example ENOENT). */
  spawnError?: string;
}
export type CliRunner = (args: readonly string[]) => Promise<CliRunResult>;

export function resolveCliEntry(): string {
  const fromEnv = process.env.CIRCLE_CLI_PATH;
  if (fromEnv) return fromEnv;
  try {
    return createRequire(import.meta.url).resolve("@circle-fin/cli");
  } catch {
    throw new WalletError("CLI_NOT_FOUND", "The Circle CLI is not installed.", "Run: pnpm add -D @circle-fin/cli, or set CIRCLE_CLI_PATH.");
  }
}

/** Runs the CLI's JS entry with the current Node, so JSON arguments never pass through a shell. */
export function nodeCliRunner(
  entry: string = resolveCliEntry(),
  timeoutMs = 90_000,
  extraEnv: Readonly<Record<string, string>> = {},
): CliRunner {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        [entry, ...args],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: "1", ...extraEnv } },
        (err, stdout, stderr) => {
          if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
            resolve({ stdout, stderr, exitCode: 127, spawnError: "ENOENT" });
            return;
          }
          const code = err ? ((err as { code?: unknown }).code as number | undefined) : 0;
          resolve({ stdout, stderr, exitCode: typeof code === "number" ? code : 1 });
        },
      );
    });
}

interface CliError {
  code?: string;
  message: string;
  hint?: string;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function cliError(r: CliRunResult): CliError {
  for (const text of [r.stdout, r.stderr]) {
    const json = extractJson(text) as { error?: { code?: string; message?: string; hint?: string } } | undefined;
    if (json?.error?.message) return { code: json.error.code, message: json.error.message, hint: json.error.hint };
  }
  const text = (r.stderr || r.stdout).trim();
  return { message: text.split("\n").filter(Boolean).slice(-1)[0] ?? `The Circle CLI exited with code ${r.exitCode}.` };
}

/**
 * A Circle Agent Wallet is a smart-contract wallet. It cannot sign until it has sent one transaction, which deploys it (found on the first real run).
 * This is the plain instruction: any tiny transfer, from this wallet, to anyone.
 */
export function activateCommand(address?: string, cliHome?: string): string {
  return `${cliHome ? `$env:CIRCLE_CLI_HOME="${cliHome}"; ` : ""}pnpm exec circle wallet transfer <any address you control> --amount 0.01 --token 0x3600000000000000000000000000000000000000 --address ${address ?? "<this wallet>"} --chain ARC-TESTNET --rpc-url https://rpc.testnet.arc.io`;
}

/** Map a failed CLI run to a typed error. Exported for tests. */
export function classifyCliFailure(r: CliRunResult, loginHint = "circle wallet login <email> --testnet", ctx: { address?: string; cliHome?: string } = {}): WalletError {
  if (r.spawnError === "ENOENT") return new WalletError("CLI_NOT_FOUND", "The Circle CLI could not be started.", "Install it with: pnpm add -D @circle-fin/cli");
  const e = cliError(r);
  const text = `${e.code ?? ""} ${e.message}`;
  if (/isn.t deployed on-chain|not deployed on-chain|wallet is not deployed/i.test(text)) {
    return new WalletError("WALLET_NOT_ACTIVATED", "Your agent wallet has not been activated yet. A Circle wallet needs one small transaction before it can sign.", `Activate your wallet: send 0.01 USDC from it to any address you control. ${activateCommand(ctx.address, ctx.cliHome)}`);
  }
  if (/terms/i.test(text) && /accept|required/i.test(text)) {
    return new WalletError("TERMS_NOT_ACCEPTED", e.message, "Accept the Circle CLI Terms of Use yourself (run `circle wallet status` once interactively).");
  }
  if (/rate.?limit|too many requests|\b429\b/i.test(text)) return new WalletError("RATE_LIMITED", e.message, "Wait and retry the same call.");
  if (/expired|not logged in|log ?in|unauthenticated|unauthori[sz]ed|session|\b401\b/i.test(text)) {
    return new WalletError("SESSION_EXPIRED", e.message, `Log in again: ${loginHint}`);
  }
  return new WalletError("CLI_ERROR", e.message, e.hint);
}

function findString(value: unknown, test: (s: string) => boolean): string | undefined {
  if (typeof value === "string") return test(value) ? value : undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const f = findString(v, test);
      if (f) return f;
    }
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const f = findString(v, test);
      if (f) return f;
    }
  }
  return undefined;
}

function findByKey(value: unknown, keys: readonly string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const v of value) {
      const f = findByKey(v, keys);
      if (f) return f;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k) && (typeof v === "string" || typeof v === "number")) return String(v);
    }
    for (const v of Object.values(value)) {
      const f = findByKey(v, keys);
      if (f) return f;
    }
  }
  return undefined;
}

const canonicalType = (p: AbiParameter): string =>
  p.type.startsWith("tuple") ? `(${(p as AbiParameter & { components: AbiParameter[] }).components.map(canonicalType).join(",")})${p.type.slice(5)}` : p.type;

/** "function approve(address spender, uint256 amount)" -> "approve(address,uint256)" */
export function functionSignature(abi: string, fn: string): string {
  const item = parseAbiItem(abi as never) as { type: string; name?: string; inputs?: AbiParameter[] };
  if (item.type !== "function" || item.name !== fn) throw new WalletError("BAD_OUTPUT", `ABI fragment does not describe function ${fn}.`);
  return `${fn}(${(item.inputs ?? []).map(canonicalType).join(",")})`;
}

/**
 * The Circle CLI only accepts a UUID as an idempotency key (a plain string answers "400 Invalid request body"; found on the first real run).
 * The same key text always gives the same UUID, so a retry still cannot send twice.
 */
export function idempotencyUuid(key: string): string {
  const h = createHash("sha256").update(key).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; // version 5 style
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function cliArg(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  // VERIFY: tuple and array encoding. We pass JSON; confirm with `--estimate` against a real wallet before relying on it.
  return JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x));
}

/**
 * The exact thing to type when a session has expired, for THIS agent's login folder. A CLI login belongs to one folder (CIRCLE_CLI_HOME), so a command
 * without it would log in the wrong one. PowerShell syntax, because that is where the owner runs it; the email is the one used for this agent.
 */
export function reloginCommand(cliHome?: string): string {
  return `${cliHome ? `$env:CIRCLE_CLI_HOME="${cliHome}"; ` : ""}pnpm exec circle wallet login <the email you used for this agent> --testnet   (then type the code Circle emails you)`;
}

export interface CircleCliAdapterOptions {
  /** The Agent Wallet address on Arc (from `circle wallet list --chain ARC-TESTNET --type agent`). */
  address: Address;
  chain?: string;
  runner?: CliRunner;
  /**
   * Folder for this agent's Circle login (sets CIRCLE_CLI_HOME for the CLI). Give the supplier and the buyer
   * different folders so the two logins do not overwrite each other. Ignored when `runner` is given.
   */
  cliHome?: string;
  /** One line per signature and transaction for the operator's terminal. Never prints a key or a full payload. */
  trace?: (line: string) => void;
  /** Arc RPC, used only for ERC-20 balanceOf reads. */
  rpcUrl?: string;
  usdc?: Address;
  eurc?: Address;
  verifier?: SignatureVerifier;
  /** Delays before each retry of a RATE_LIMITED call. */
  backoffMs?: readonly number[];
  loginHint?: string;
  /** Reads the code at the wallet address. Replaceable for tests; by default a real call to the RPC (skipped, and never assumed, when no RPC is set). */
  codeOf?: (address: Address) => Promise<string | undefined>;
}

export class CircleCliAdapter implements WalletAdapter {
  readonly mode = "agent" as const;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly chain: string;
  private readonly runner: CliRunner;
  private readonly verifier: SignatureVerifier;
  private readonly backoff: readonly number[];

  constructor(private readonly o: CircleCliAdapterOptions) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(o.address)) throw new WalletError("NOT_CONFIGURED", "The agent wallet address is not set or is malformed.");
    this.chain = o.chain ?? "ARC-TESTNET";
    this.runner = o.runner ?? nodeCliRunner(undefined, undefined, o.cliHome ? { CIRCLE_CLI_HOME: o.cliHome } : {});
    this.verifier = o.verifier ?? eoaVerifier;
    this.backoff = o.backoffMs ?? [1_000, 3_000, 8_000];
  }

  async address(): Promise<Address> {
    return this.o.address;
  }

  private async codeOf(): Promise<string | undefined | null> {
    if (this.o.codeOf) return this.o.codeOf(this.o.address);
    if (!this.o.rpcUrl) return null; // cannot tell: not a failure, not a pass
    try {
      return (await createPublicClient({ transport: http(this.o.rpcUrl) }).getCode({ address: this.o.address })) ?? "0x";
    } catch {
      return null;
    }
  }

  /** One call at a time. A rate limit is retried with backoff; every other failure surfaces as a typed error. */
  private run(args: readonly string[]): Promise<unknown> {
    const job = async (): Promise<unknown> => {
      for (let attempt = 0; ; attempt++) {
        const r = await this.runner([...args, "--output", "json"]);
        if (r.exitCode === 0 && !r.spawnError) {
          const json = extractJson(r.stdout);
          if (json === undefined) throw new WalletError("BAD_OUTPUT", "The Circle CLI returned no JSON.", r.stdout.slice(0, 200));
          return json;
        }
        const err = classifyCliFailure(r, this.o.loginHint ?? reloginCommand(this.o.cliHome), { address: this.o.address, cliHome: this.o.cliHome });
        if (err.code === "RATE_LIMITED" && attempt < this.backoff.length) {
          await new Promise((res) => setTimeout(res, this.backoff[attempt]));
          continue;
        }
        throw err;
      }
    };
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }

  async signTypedData(payload: Eip712Payload): Promise<Hex> {
    const t0 = Date.now();
    this.o.trace?.(`wallet  signing ${payload.primaryType} with the Circle Agent Wallet ${this.o.address.slice(0, 8)}…`);
    const json = await this.run([
      "wallet", "sign", "typed-data", typedDataJson(payload),
      "--address", this.o.address, "--chain", this.chain,
    ]);
    const sig = findString(json, (s) => /^0x[0-9a-fA-F]{130,}$/.test(s));
    if (!sig) throw new WalletError("BAD_OUTPUT", "The Circle CLI did not return a signature.");
    // Verify locally before the signature is stored or sent (spec 5.6).
    const ok = await this.verifier(payload, sig as Hex, this.o.address).catch(() => false);
    if (!ok) throw new WalletError("SIGNATURE_MISMATCH", "The signature does not recover to the agent wallet address.");
    this.o.trace?.(`wallet  signed ${payload.primaryType} ${sig.slice(0, 12)}…, verified against the wallet (ERC-1271) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return sig as Hex;
  }

  async execute(call: ContractCall): Promise<ExecuteResult> {
    const args = [
      "wallet", "execute", functionSignature(call.abi, call.fn), ...call.args.map(cliArg),
      "--contract", call.to, "--address", this.o.address, "--chain", this.chain,
    ];
    if (call.idempotencyKey) args.push("--idempotency-key", idempotencyUuid(call.idempotencyKey));
    const t0 = Date.now();
    this.o.trace?.(`chain   sending ${call.fn}() to ${call.to.slice(0, 10)}… on Arc from ${this.o.address.slice(0, 8)}…`);
    const raw = await this.run(args);
    const txHash = findString(raw, (s) => /^0x[0-9a-fA-F]{64}$/.test(s)) as Hex | undefined;
    const transactionId = findByKey(raw, ["transactionId", "id"]);
    if (!txHash && !transactionId) throw new WalletError("BAD_OUTPUT", "The Circle CLI returned neither a transaction hash nor an id.");
    this.o.trace?.(`chain   ${call.fn}() confirmed ${txHash ?? transactionId} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return { txHash, transactionId, raw };
  }

  async balance(token: "USDC" | "EURC"): Promise<bigint> {
    const tokenAddress = token === "USDC" ? this.o.usdc : this.o.eurc;
    if (!this.o.rpcUrl || !tokenAddress) throw new WalletError("NOT_CONFIGURED", `Set the Arc RPC URL and the ${token} address to read balances.`);
    try {
      const client = createPublicClient({ transport: http(this.o.rpcUrl) });
      return await client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [this.o.address] });
    } catch (e) {
      throw new WalletError("UNAVAILABLE", `Could not read the ${token} balance: ${(e as Error).message}`);
    }
  }

  /** Session check plus proof that the configured address is one of this login's agent wallets. */
  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.run(["wallet", "status", "--type", "agent"]);
      const list = await this.run(["wallet", "list", "--chain", this.chain, "--type", "agent"]);
      const listed = findString(list, (s) => s.toLowerCase() === this.o.address.toLowerCase());
      if (!listed) return { ok: false, detail: "The configured address is not an agent wallet of the current login." };
      // A smart-contract wallet has code on chain once it has sent its first transaction. Without it, signing fails, so say so before anything is attempted.
      const code = await this.codeOf();
      if (code === "0x") return { ok: false, detail: `WALLET_NOT_ACTIVATED: your agent wallet has not been activated yet. Activate your wallet: send 0.01 USDC from it to any address you control. ${activateCommand(this.o.address, this.o.cliHome)}` };
      return { ok: true };
    } catch (e) {
      const err = e as WalletError;
      return { ok: false, detail: err.hint ? `${err.code}: ${err.message} ${err.hint}` : `${err.code}: ${err.message}` };
    }
  }
}

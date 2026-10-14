import { randomBytes } from "node:crypto";
import { z } from "zod";
import { agentReadTypedData, type Domain, type ExposurePolicy, type InvoiceEvent } from "../core/index.js";
import type { WalletAdapter } from "../wallets/types.js";

/**
 * Reads of the agent's own business data from the Misthos API, proved by a wallet signature instead of a browser session
 * (the API checks the EIP-712 AgentRead against the agent wallets it was configured with). Anything that goes wrong is thrown,
 * never defaulted: the caller treats a thrown read as "unavailable" and fails closed (SRS NFR-05).
 */
export interface SignedReader {
  /** GET a path (for example "/api/agent/exposure-policy") and return the `data` of the envelope. */
  get(path: string): Promise<unknown>;
}

/** The network call, replaceable so a test can talk to an API running in the same process. */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function signedReader(args: { backendUrl: string; wallet: WalletAdapter; domain: Domain; now?: () => number; timeoutMs?: number; fetch?: FetchLike }): SignedReader {
  const base = args.backendUrl.replace(/\/$/, "");
  const now = args.now ?? (() => Math.floor(Date.now() / 1000));
  return {
    async get(path) {
      const ts = now();
      const nonce = randomBytes(16).toString("hex");
      const wallet = await args.wallet.address();
      const signature = await args.wallet.signTypedData(agentReadTypedData(args.domain, { resource: path, ts, nonce }) as never);
      const res = await (args.fetch ?? fetch)(`${base}${path}`, {
        headers: { "x-agent-wallet": wallet, "x-agent-ts": String(ts), "x-agent-nonce": nonce, "x-agent-sig": signature },
        signal: AbortSignal.timeout(args.timeoutMs ?? 15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: unknown; error?: { message?: string } };
      if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `The API answered ${res.status}.`);
      return body.data;
    },
  };
}

const uintString = z.string().regex(/^\d{1,30}$/);
const exposurePolicyReply = z.discriminatedUnion("configured", [
  z.strictObject({ configured: z.literal(false) }),
  z.strictObject({
    configured: z.literal(true),
    version: z.string().max(40),
    newCounterpartyLimit: uintString,
    maxLimit: uintString,
    growthBps: z.number().int().min(0).max(10_000),
    lookbackDays: z.number().int().min(1).max(730),
    graceSeconds: z.number().int().min(0).max(2_592_000),
  }),
]);

/** The credit policy the owner saved, or null when none is set (then nothing is limited, and nothing claims a check). Throws if unreadable. */
export async function fetchExposurePolicy(reader: SignedReader): Promise<ExposurePolicy | null> {
  const p = exposurePolicyReply.parse(await reader.get("/api/agent/exposure-policy"));
  if (!p.configured) return null;
  return { version: p.version, newCounterpartyLimit: BigInt(p.newCounterpartyLimit), maxLimit: BigInt(p.maxLimit), growthBps: p.growthBps, lookbackDays: p.lookbackDays, graceSeconds: p.graceSeconds };
}

const eventRows = z.array(
  z.strictObject({
    invoiceId: z.string().max(80),
    state: z.enum(["approved", "settled_early", "settled_on_due", "disputed"]),
    face: uintString,
    outflow: uintString.optional(),
    rateBps: z.number().int().min(0).max(5000).optional(),
    dueSec: z.number().int().min(0),
    settledAtSec: z.number().int().min(0).optional(),
    txHash: z.string().max(80).optional(),
    logIndex: z.number().int().min(0).optional(),
  }),
);

/** The invoices between this business and one counterparty, from indexed chain events (public data, no sign-in). Throws if unreadable. */
export async function fetchExposureEvents(args: { backendUrl: string; side: "supplier" | "buyer"; owner: string; counterparty: string; timeoutMs?: number; fetch?: FetchLike }): Promise<InvoiceEvent[]> {
  const q = new URLSearchParams({ side: args.side, owner: args.owner.toLowerCase(), counterparty: args.counterparty.toLowerCase() });
  const res = await (args.fetch ?? fetch)(`${args.backendUrl.replace(/\/$/, "")}/api/exposure?${q}`, { signal: AbortSignal.timeout(args.timeoutMs ?? 15_000) });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { events?: unknown }; error?: { message?: string } };
  if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `The API answered ${res.status}.`);
  return eventRows.parse(body.data?.events).map((e) => ({
    invoiceId: e.invoiceId,
    state: e.state,
    face: BigInt(e.face),
    ...(e.outflow !== undefined ? { outflow: BigInt(e.outflow) } : {}),
    ...(e.rateBps !== undefined ? { rateBps: e.rateBps } : {}),
    dueSec: BigInt(e.dueSec),
    ...(e.settledAtSec !== undefined ? { settledAtSec: BigInt(e.settledAtSec) } : {}),
    ...(e.txHash !== undefined ? { txHash: e.txHash } : {}),
    ...(e.logIndex !== undefined ? { logIndex: e.logIndex } : {}),
  }));
}

/**
 * Redeem a one-time link code made by the signed-in owner on the website. The request is signed by this agent's wallet over the
 * exact path (which contains the code), so it proves the agent is the wallet it names and cannot be replayed for another code.
 * Both halves are needed to link: the owner's session made the code, this wallet redeems it.
 */
export async function linkAgent(args: { backendUrl: string; wallet: WalletAdapter; domain: Domain; code: string; now?: () => number; timeoutMs?: number; fetch?: FetchLike }): Promise<{ ok: true } | { ok: false; message: string }> {
  const path = `/api/agent/link/${encodeURIComponent(args.code.trim())}`;
  const ts = (args.now ?? (() => Math.floor(Date.now() / 1000)))();
  const nonce = randomBytes(16).toString("hex");
  try {
    const wallet = await args.wallet.address();
    const signature = await args.wallet.signTypedData(agentReadTypedData(args.domain, { resource: path, ts, nonce }) as never);
    const res = await (args.fetch ?? fetch)(`${args.backendUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "x-agent-wallet": wallet, "x-agent-ts": String(ts), "x-agent-nonce": nonce, "x-agent-sig": signature },
      signal: AbortSignal.timeout(args.timeoutMs ?? 15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
    return res.ok && body.ok ? { ok: true } : { ok: false, message: body.error?.message ?? `The API answered ${res.status}.` };
  } catch (e) {
    return { ok: false, message: `Could not reach the API: ${(e as Error).message}` };
  }
}

const payableRows = z.array(z.strictObject({ invoiceId: z.string().max(80), face: uintString, dueSec: z.number().int().min(0) }));

/**
 * What this buyer owes on invoices that are approved and unpaid, whoever the supplier is. These are on-chain facts (the contract will
 * take this money on each due date), so unlike a calendar the owner typed they are VERIFIED obligations. The id carries the invoice id so
 * the invoice being decided is never counted against itself. Throws if the API cannot answer: the buyer then fails closed.
 */
export async function fetchPayables(args: { backendUrl: string; buyer: string; timeoutMs?: number; fetch?: FetchLike }): Promise<Array<{ id: string; dueSec: bigint; amount: bigint; provenance: "onchain" }>> {
  const res = await (args.fetch ?? fetch)(`${args.backendUrl.replace(/\/$/, "")}/api/payables?buyer=${args.buyer.toLowerCase()}`, { signal: AbortSignal.timeout(args.timeoutMs ?? 15_000) });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { payables?: unknown }; error?: { message?: string } };
  if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `The API answered ${res.status}.`);
  return payableRows.parse(body.data?.payables).map((p) => ({ id: `invoice:${p.invoiceId.toLowerCase()}`, dueSec: BigInt(p.dueSec), amount: BigInt(p.face), provenance: "onchain" as const }));
}

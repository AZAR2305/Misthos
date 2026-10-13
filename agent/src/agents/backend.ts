import { z } from "zod";
import { agentReadTypedData, type BuyerObligation, type Domain, type ExposurePolicy, type InvoiceEvent } from "../core/index.js";
import type { WalletAdapter } from "../wallets/types.js";

/**
 * Reads of the agent's own business data from the Misthos API, proved by a wallet signature instead of a browser session
 * (the API checks the EIP-712 AgentRead against the agent wallets it was configured with). Anything that goes wrong is thrown,
 * never defaulted: the caller treats a thrown read as "unavailable" and fails closed (SRS NFR-05).
 */
export interface SignedReader {
  /** GET a path (for example "/api/agent/obligations") and return the `data` of the envelope. */
  get(path: string): Promise<unknown>;
}

export function signedReader(args: { backendUrl: string; wallet: WalletAdapter; domain: Domain; now?: () => number; timeoutMs?: number }): SignedReader {
  const base = args.backendUrl.replace(/\/$/, "");
  const now = args.now ?? (() => Math.floor(Date.now() / 1000));
  return {
    async get(path) {
      const ts = now();
      const wallet = await args.wallet.address();
      const signature = await args.wallet.signTypedData(agentReadTypedData(args.domain, { resource: path, ts }) as never);
      const res = await fetch(`${base}${path}`, {
        headers: { "x-agent-wallet": wallet, "x-agent-ts": String(ts), "x-agent-sig": signature },
        signal: AbortSignal.timeout(args.timeoutMs ?? 15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: unknown; error?: { message?: string } };
      if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `The API answered ${res.status}.`);
      return body.data;
    },
  };
}

const obligationRows = z.array(
  z.strictObject({
    id: z.string().max(80),
    amount: z.string().regex(/^\d+$/),
    dueSec: z.number().int().min(0),
    kind: z.enum(["payroll", "bill", "other"]),
    provenance: z.literal("declared"),
  }),
);

/** The buyer's payment calendar as the owner declared it. Every row is labelled declared: nothing backs it on chain. */
export async function fetchObligations(reader: SignedReader): Promise<BuyerObligation[]> {
  const rows = obligationRows.parse(await reader.get("/api/agent/obligations"));
  return rows.map((r) => ({ id: r.id, dueSec: BigInt(r.dueSec), amount: BigInt(r.amount), provenance: "declared" as const }));
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
    dueSec: z.number().int().min(0),
    settledAtSec: z.number().int().min(0).optional(),
    txHash: z.string().max(80).optional(),
    logIndex: z.number().int().min(0).optional(),
  }),
);

/** The invoices between this business and one counterparty, from indexed chain events (public data, no sign-in). Throws if unreadable. */
export async function fetchExposureEvents(args: { backendUrl: string; side: "supplier" | "buyer"; owner: string; counterparty: string; timeoutMs?: number }): Promise<InvoiceEvent[]> {
  const q = new URLSearchParams({ side: args.side, owner: args.owner.toLowerCase(), counterparty: args.counterparty.toLowerCase() });
  const res = await fetch(`${args.backendUrl.replace(/\/$/, "")}/api/exposure?${q}`, { signal: AbortSignal.timeout(args.timeoutMs ?? 15_000) });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { events?: unknown }; error?: { message?: string } };
  if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `The API answered ${res.status}.`);
  return eventRows.parse(body.data?.events).map((e) => ({
    invoiceId: e.invoiceId,
    state: e.state,
    face: BigInt(e.face),
    ...(e.outflow !== undefined ? { outflow: BigInt(e.outflow) } : {}),
    dueSec: BigInt(e.dueSec),
    ...(e.settledAtSec !== undefined ? { settledAtSec: BigInt(e.settledAtSec) } : {}),
    ...(e.txHash !== undefined ? { txHash: e.txHash } : {}),
    ...(e.logIndex !== undefined ? { logIndex: e.logIndex } : {}),
  }));
}

import { z } from "zod";
import { agentReadTypedData, type BuyerObligation, type Domain } from "../core/index.js";
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

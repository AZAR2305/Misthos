/**
 * Latest real settlement, for the hero curve (CLAUDE.md 11 P1).
 *
 * There is no backend yet, so this reports "unavailable" honestly. It must never return seeded or
 * invented values (CLAUDE.md 0.5). When GET /api/stats exists, fetch it here and return the real row.
 */
export type LatestSettlement =
  | { status: "unavailable"; reason: string }
  | { status: "empty" }
  | {
      status: "ready";
      invoiceRef: string;
      daysEarly: number;
      discountMinor: bigint;
      netMinor: bigint;
      rateBps: number;
      txHash: `0x${string}`;
    };

export async function getLatestSettlement(): Promise<LatestSettlement> {
  return { status: "unavailable", reason: "The stats API is not connected yet." };
}

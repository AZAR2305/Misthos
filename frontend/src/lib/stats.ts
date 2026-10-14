import { BPS, SECONDS_PER_YEAR, effectiveAprBps, formatUsd } from "./core";
import type { InvoiceRecord } from "./chain/invoices";
import { originOfInvoice, type Origin, type OriginRegistry } from "./origins";

/** Public traction numbers, recomputed from chain events (CLAUDE.md P10). Nothing here is typed in or estimated. */
export interface SettlementRow {
  id: `0x${string}`;
  face: bigint;
  net: bigint;
  discount: bigint;
  fee: bigint;
  rateBps: number;
  dueSec: number;
  paidSec: number;
  /** Whole days between payment and the due date. */
  daysEarly: number;
  aprBps: bigint;
  tx: `0x${string}`;
  /** Where it came from: pilot (counts), team (our own wallets), or unverified. Origins are never added together. */
  origin: Origin;
}

export function settlementRows(invoices: readonly InvoiceRecord[], time: (block: bigint) => number | undefined, registry: OriginRegistry): SettlementRow[] {
  const rows: SettlementRow[] = [];
  for (const inv of invoices) {
    const s = inv.settled;
    if (!s || s.kind !== "early") continue;
    const paidSec = time(s.block);
    if (paidSec === undefined) continue;
    const dueSec = Number(inv.dueDate);
    const secondsEarly = BigInt(Math.max(0, dueSec - paidSec));
    rows.push({
      id: inv.id,
      face: inv.amount,
      net: s.net,
      discount: s.discount,
      fee: s.fee,
      rateBps: s.rateBps,
      dueSec,
      paidSec,
      daysEarly: Math.floor(Number(secondsEarly) / 86_400),
      aprBps: effectiveAprBps(s.discount, s.net, secondsEarly),
      tx: s.tx,
      origin: originOfInvoice(inv, registry),
    });
  }
  return rows.sort((a, b) => b.paidSec - a.paidSec);
}

export interface Summary {
  count: number;
  face: bigint;
  net: bigint;
  discount: bigint;
  fee: bigint;
  medianDaysEarly: number | null;
  /** Share of settlements that cleared at exactly 0%, as a whole percent. */
  zeroSharePct: number | null;
  /** Discount earned over net paid and time, annualised, in basis points. */
  weightedAprBps: bigint | null;
}

export function summarise(rows: readonly SettlementRow[]): Summary {
  let face = 0n;
  let net = 0n;
  let discount = 0n;
  let fee = 0n;
  let netSeconds = 0n;
  for (const r of rows) {
    face += r.face;
    net += r.net;
    discount += r.discount;
    fee += r.fee;
    netSeconds += r.net * BigInt(Math.max(0, r.dueSec - r.paidSec));
  }
  const days = rows.map((r) => r.daysEarly).sort((a, b) => a - b);
  const mid = days.length / 2;
  const median = days.length === 0 ? null : days.length % 2 ? days[Math.floor(mid)]! : (days[mid - 1]! + days[mid]!) / 2;
  return {
    count: rows.length,
    face,
    net,
    discount,
    fee,
    medianDaysEarly: median,
    zeroSharePct: rows.length === 0 ? null : Math.round((rows.filter((r) => r.rateBps === 0).length / rows.length) * 100),
    weightedAprBps: netSeconds === 0n ? null : (discount * BPS * SECONDS_PER_YEAR) / netSeconds,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one plain sentence that leads /stats. Empty chain gives an honest empty sentence. */
export function headline(s: Summary): string {
  if (s.count === 0) return "No invoice has been paid early on this network yet.";
  const med = s.medianDaysEarly === null ? "" : ` a median ${s.medianDaysEarly} ${s.medianDaysEarly === 1 ? "day" : "days"}`;
  const apr = s.weightedAprBps === null ? "" : ` Buyers earned ${(Number(s.weightedAprBps) / 100).toFixed(1)}% annualised.`;
  const zero = s.zeroSharePct ? ` ${s.zeroSharePct}% cleared at 0%.` : "";
  return `${plural(s.count, "invoice was", "invoices were")} paid${med} early, moving ${formatUsd(s.net)} in USDC.${apr}${zero}`;
}

/** Only the rows of one origin. There is deliberately no function that totals across origins. */
export const ofOrigin = (rows: readonly SettlementRow[], origin: Origin) => rows.filter((r) => r.origin === origin);

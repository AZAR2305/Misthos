import type { InvoiceRecord } from "./chain/invoices";

/**
 * Where activity comes from, so that only a documented, independent business can ever count as traction.
 *   team        a wallet the build team created or controls. Always team, whatever anyone says.
 *   pilot       at least one side is a wallet of a pilot with a COMPLETE written independence note, and no side is a team wallet.
 *   unverified  everything else on the chain: real or not, nobody has documented it, so it is not counted as traction.
 * A shadow report is a different thing again (source=shadow): a computation, never on-chain activity, never part of these.
 */
export type Origin = "pilot" | "team" | "unverified";
export const ORIGINS: readonly Origin[] = ["pilot", "team", "unverified"];

export interface IndependenceNote {
  /** Who they are (a business name you may disclose, or an anonymous but real description). */
  who: string;
  /** Not on the build team, and not owned by them. */
  notOnTeam: boolean;
  /** The wallet belongs to them, not to us. */
  walletIsTheirs: boolean;
  /** YYYY-MM-DD the note was written. */
  date: string;
}
export interface OriginRegistry {
  team: { label: string; address: string }[];
  pilots: { label: string; wallets: string[]; independence: IndependenceNote }[];
}

const lower = (a: string) => a.toLowerCase();

/** Problems that make a registry untrustworthy. Empty when it is fine. A pilot entry with any problem is ignored. */
export function registryProblems(reg: OriginRegistry): string[] {
  const out: string[] = [];
  const team = new Set(reg.team.map((t) => lower(t.address)));
  for (const p of reg.pilots) {
    const n = p.independence;
    if (!p.label?.trim()) out.push("A pilot has no label.");
    if (!n || !n.who?.trim() || n.notOnTeam !== true || n.walletIsTheirs !== true || !/^\d{4}-\d{2}-\d{2}$/.test(n.date ?? "")) out.push(`Pilot "${p.label}" has no complete independence note (who, notOnTeam, walletIsTheirs, date).`);
    if (!p.wallets?.length) out.push(`Pilot "${p.label}" lists no wallet.`);
    for (const w of p.wallets ?? []) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(w)) out.push(`Pilot "${p.label}" has a malformed wallet.`);
      if (team.has(lower(w))) out.push(`Pilot "${p.label}" lists a wallet that is also a team wallet (${w}). It cannot be both.`);
    }
  }
  return out;
}

const validPilots = (reg: OriginRegistry) => reg.pilots.filter((p) => registryProblems({ team: reg.team, pilots: [p] }).length === 0);

export function originOf(parties: { supplier: string; buyer: string }, reg: OriginRegistry): Origin {
  const team = new Set(reg.team.map((t) => lower(t.address)));
  if (team.has(lower(parties.supplier)) || team.has(lower(parties.buyer))) return "team";
  const pilot = new Set(validPilots(reg).flatMap((p) => p.wallets.map(lower)));
  return pilot.has(lower(parties.supplier)) || pilot.has(lower(parties.buyer)) ? "pilot" : "unverified";
}

export function originOfInvoice(inv: Pick<InvoiceRecord, "supplier" | "buyer">, reg: OriginRegistry): Origin {
  return originOf(inv, reg);
}

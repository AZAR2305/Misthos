import type { StoredObligations } from "./storage";

type Item = StoredObligations[number];

/** The server's obligation rows into the shape the page already uses. Anything malformed makes the whole list unavailable. */
export function parseObligations(raw: unknown): StoredObligations | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Item[] = [];
  for (const r of raw) {
    const o = r as { id?: unknown; label?: unknown; amount?: unknown; dueDate?: unknown; kind?: unknown };
    const ms = typeof o.dueDate === "string" ? Date.parse(o.dueDate) : NaN;
    if (typeof o.id !== "string" || typeof o.label !== "string" || typeof o.amount !== "string" || !/^\d+$/.test(o.amount) || !Number.isFinite(ms)) return undefined;
    if (o.kind !== "payroll" && o.kind !== "bill" && o.kind !== "other") return undefined;
    out.push({ id: o.id, label: o.label, amount: o.amount, dueSec: String(Math.floor(ms / 1000)), kind: o.kind });
  }
  return out;
}

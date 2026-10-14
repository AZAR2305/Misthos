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

/**
 * The buyer agent's own answer from GET /obligations: `{ declared, items }`. Malformed rows make the whole list unavailable, and a calendar
 * the owner never declared is reported as such (the agent then accepts nothing until it is).
 */
export function parseAgentObligations(raw: unknown): { declared: boolean; items: StoredObligations } | undefined {
  const r = raw as { declared?: unknown; items?: unknown } | null;
  if (!r || typeof r.declared !== "boolean" || !Array.isArray(r.items)) return undefined;
  const items: Item[] = [];
  for (const x of r.items) {
    const o = x as { id?: unknown; label?: unknown; amount?: unknown; dueSec?: unknown; kind?: unknown };
    if (typeof o.id !== "string" || typeof o.label !== "string" || typeof o.amount !== "string" || !/^\d+$/.test(o.amount) || typeof o.dueSec !== "string" || !/^\d+$/.test(o.dueSec)) return undefined;
    if (o.kind !== "payroll" && o.kind !== "bill" && o.kind !== "other") return undefined;
    items.push({ id: o.id, label: o.label, amount: o.amount, dueSec: o.dueSec, kind: o.kind });
  }
  return { declared: r.declared, items };
}

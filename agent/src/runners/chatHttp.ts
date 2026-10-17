import { z } from "zod";
import type { ChatAgent } from "../agents/chat.js";
import type { DecisionLine, InvoiceLine } from "../agents/chatTools.js";

/** The three chat routes, shared by both agent processes. They are not open routes: they need the same control token as every other write. */
export function chatRoutes(chat: ChatAgent) {
  const say = z.strictObject({ text: z.string().min(1).max(1000) });
  const code = z.strictObject({ token: z.string().regex(/^[0-9a-f]{12}$/) });
  return {
    "POST /chat": async ({ body }: { body: unknown }) => chat.handle(say.parse(body).text),
    "POST /chat/confirm": async ({ body }: { body: unknown }) => chat.confirm(code.parse(body).token),
    "POST /chat/cancel": async ({ body }: { body: unknown }) => chat.cancel(code.parse(body).token),
  };
}

/** The owner's own invoices from the public index. Throws when the index cannot be read, so the agent says so rather than guessing. */
export async function fetchInvoiceLines(backendUrl: string, who: { supplier?: string; buyer?: string }, statuses: readonly string[]): Promise<InvoiceLine[]> {
  const q = new URLSearchParams({ limit: "200" });
  if (who.supplier) q.set("supplier", who.supplier.toLowerCase());
  if (who.buyer) q.set("buyer", who.buyer.toLowerCase());
  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/api/invoices?${q}`, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { items?: unknown }; error?: { message?: string } };
  if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `The API answered ${res.status}.`);
  const rows = z
    .array(z.object({ id: z.string(), supplier: z.string(), buyer: z.string(), amount: z.union([z.string(), z.number()]), dueDate: z.union([z.string(), z.number()]), status: z.string() }).passthrough())
    .parse(body.data?.items);
  return rows
    .filter((r) => statuses.includes(r.status))
    .map((r) => ({ id: r.id, counterparty: who.supplier ? r.buyer : r.supplier, amount: BigInt(r.amount), dueSec: Number(r.dueDate), status: r.status }));
}

export const toDecisionLines = (rows: ReadonlyArray<{ at: number; outcome: string; reason: string }>, n: number): DecisionLine[] => rows.slice(-n).reverse().map((r) => ({ at: r.at, outcome: r.outcome, reason: r.reason }));

/**
 * Wallet health spawns the Circle CLI, which takes seconds on a small machine, while the website gives up after 2.5 s. So the last answer is served at once and
 * refreshed in the background every 20 s. Only the very first call waits. A failed check is served as a failure, never as a stale success.
 */
export function cachedHealth<T>(fn: () => Promise<T>): () => Promise<T> {
  let last: { ok: true; value: T } | { ok: false; err: unknown } | undefined;
  let inflight: Promise<void> | undefined;
  const refresh = () =>
    (inflight ??= fn()
      .then(
        (value) => void (last = { ok: true, value }),
        (err) => void (last = { ok: false, err }),
      )
      .finally(() => void (inflight = undefined)));
  void refresh();
  setInterval(() => void refresh(), 20_000).unref();
  return async () => {
    if (!last) await refresh();
    if (last!.ok) return last!.value;
    throw last!.err;
  };
}

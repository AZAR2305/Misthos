import { z } from "zod";
import { formatUsd, toMinor } from "../core/index.js";
import { ID_IN_TEXT, invoiceRef, resolveInvoice, type ChatTool } from "./chat.js";

/**
 * The tools each agent offers to its owner in text. Each one is thin: it asks the agent code that already exists (the same code the buttons use) and
 * words the answer. None of them reaches a signer except through that code, and the ones that move money or change a private setting need a confirmation.
 */
export interface InvoiceLine {
  id: string;
  counterparty: string;
  amount: bigint;
  dueSec: number;
  status: string;
}
export interface DecisionLine {
  at?: number;
  outcome: string;
  reason: string;
}

const short = (h: string) => `${h.slice(0, 10)}…`;
const date = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const line = (i: InvoiceLine) => `${short(i.id)}  ${formatUsd(i.amount)}  due ${date(i.dueSec)}  ${i.status}  with ${i.counterparty.slice(0, 8)}…`;
const empty = z.strictObject({});
const withInvoice = z.strictObject({ invoice: invoiceRef });
const idMatch = (text: string) => ID_IN_TEXT.exec(text)?.[0];

export interface CommonDeps {
  health(): Promise<{ wallet: { ok: boolean; detail?: string }; modelConfigured: boolean }>;
  decisions(n: number): DecisionLine[];
}

function common(d: CommonDeps): ChatTool[] {
  return [
    {
      name: "status",
      description: "say whether I am running: my wallet, my model",
      args: empty,
      match: (t) => (/^(status|health|are you (ok|running|working)|how are you)\b/i.test(t) ? {} : undefined),
      run: async () => {
        const h = await d.health();
        return { text: `${h.wallet.ok ? "My wallet is ready." : `My wallet needs attention: ${h.wallet.detail ?? "unknown"}`} ${h.modelConfigured ? "My language model is configured." : "I have no language model key, so I only understand plain requests."}`, data: h };
      },
    },
    {
      name: "recent_decisions",
      description: "show what I decided recently, and why",
      args: z.strictObject({ n: z.number().int().min(1).max(20).default(5) }),
      match: (t) => (/^(recent|last|show|what did you) .*(decision|decide|did)/i.test(t) || /^decisions?\b/i.test(t) ? {} : undefined),
      run: async ({ n }) => {
        const rows = d.decisions(n);
        return { text: rows.length ? rows.map((r) => `${r.at ? new Date(r.at * 1000).toISOString().slice(0, 16).replace("T", " ") : ""}  ${r.outcome}: ${r.reason}`).join("\n") : "I have not made any decisions yet.", data: rows };
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------------- supplier

export interface SupplierChatDeps extends CommonDeps {
  /** The supplier's own invoices, from the public index. Throws if the index is not configured or cannot be read. */
  listInvoices(): Promise<InvoiceLine[]>;
  /** The agent's own range for one invoice, in words. */
  explain(id: string): Promise<string>;
  /** Run the ladder. Returns the result in words. */
  negotiate(id: string): Promise<string>;
}

export function supplierTools(d: SupplierChatDeps): ChatTool[] {
  const mine = async (ref: string) => resolveInvoice(ref, (await d.listInvoices()).map((i) => i.id));
  return [
    ...common(d),
    {
      name: "list_invoices",
      description: "list your invoices",
      args: empty,
      match: (t) => (/^(list|show|what are|what's|whats)?\s*(my\s+|all\s+|open\s+)*invoices\??$/i.test(t) ? {} : undefined),
      run: async () => {
        const rows = await d.listInvoices();
        return { text: rows.length ? rows.map(line).join("\n") : "You have no invoices yet.", data: rows.map((r) => ({ ...r, amount: r.amount.toString() })) };
      },
    },
    {
      name: "explain_invoice",
      description: "explain the price range and credit position I would use for one invoice (give its id)",
      args: withInvoice,
      match: (t) => (/^(explain|why|range|what.*(price|rate))/i.test(t) && idMatch(t) ? { invoice: idMatch(t)! } : undefined),
      run: async ({ invoice }) => ({ text: await d.explain(await mine(invoice)) }),
    },
    {
      name: "negotiate",
      description: "ask the buyer's agent to pay one invoice early (give its id). I start at 0% and climb only to the ceiling you configured",
      args: withInvoice,
      confirm: true,
      match: (t) => (/^(negotiate|offer|start|get me paid|ask .* to pay|pay me)/i.test(t) && idMatch(t) ? { invoice: idMatch(t)! } : undefined),
      describe: async ({ invoice }) => {
        const id = await mine(invoice);
        const inv = (await d.listInvoices()).find((i) => i.id === id)!;
        return `I would start negotiating early payment of invoice ${short(id)} (${formatUsd(inv.amount)}, due ${date(inv.dueSec)}) with its buyer. I begin at 0% and only climb to the ceiling you set; I sign each offer with my own wallet, and nothing is paid unless the buyer's agent accepts.`;
      },
      run: async ({ invoice }) => ({ text: await d.negotiate(await mine(invoice)) }),
    },
  ];
}

// ---------------------------------------------------------------------------------------------------- buyer

export interface BuyerChatDeps extends CommonDeps {
  /** What the chain says this buyer owes on approved, unpaid invoices. */
  payables(): Promise<InvoiceLine[]>;
  /** Offers the agent holds back for a person (id, reason). */
  held(): Array<{ id: string; reason: string }>;
  /** The best set to pay early now, in words, from the same allocator the agent uses. Read-only. */
  plan(): Promise<{ text: string; ids: string[] }>;
  executePlan(): Promise<string>;
  acceptHeld(id: string): Promise<string>;
  payments(): Array<{ id: string; label: string; amount: bigint; dueSec: number; kind: string }>;
  addPayment(p: { label: string; amount: bigint; dueSec: number; kind: "payroll" | "bill" | "other" }): string;
}

export function buyerTools(d: BuyerChatDeps): ChatTool[] {
  const heldId = (ref: string) => resolveInvoice(ref, d.held().map((h) => h.id));
  return [
    ...common(d),
    {
      name: "list_payables",
      description: "list the invoices you owe (approved and unpaid)",
      args: empty,
      match: (t) => (/^(list|show|what do i owe|what are|what's|whats)?\s*(my\s+|all\s+|open\s+)*(payables|invoices|what i owe)\??$/i.test(t) || /^what do i owe/i.test(t) ? {} : undefined),
      run: async () => {
        const rows = await d.payables();
        return { text: rows.length ? rows.map(line).join("\n") : "You owe nothing on approved invoices right now.", data: rows.map((r) => ({ ...r, amount: r.amount.toString() })) };
      },
    },
    {
      name: "held",
      description: "show payments I held back for you, and why",
      args: empty,
      match: (t) => (/^(held|what is waiting|waiting|approvals?|what needs me|needs approval)/i.test(t) ? {} : undefined),
      run: async () => {
        const rows = d.held();
        return { text: rows.length ? rows.map((r) => `${short(r.id)}: ${r.reason}`).join("\n") : "Nothing is waiting for you.", data: rows };
      },
    },
    {
      name: "plan",
      description: "work out the best set of invoices to pay early with your cash, without paying anything",
      args: empty,
      match: (t) => (/^(plan|what should i pay( early)?|suggest|what to pay)/i.test(t) ? {} : undefined),
      run: async () => ({ text: (await d.plan()).text }),
    },
    {
      name: "execute_plan",
      description: "pay the invoices in that plan early",
      args: empty,
      confirm: true,
      match: (t) => (/^(execute|run|do|carry out|pay)( the)? plan\b/i.test(t) ? {} : undefined),
      describe: async () => {
        const p = await d.plan();
        return p.ids.length ? `I would pay these early from your wallet, one by one, each through the contract: ${p.text}` : `There is nothing to pay early right now. ${p.text}`;
      },
      run: async () => ({ text: await d.executePlan() }),
    },
    {
      name: "accept_held",
      description: "accept a payment I held back for you (give the invoice id)",
      args: withInvoice,
      confirm: true,
      match: (t) => (/^(accept|pay|approve|release)/i.test(t) && idMatch(t) ? { invoice: idMatch(t)! } : undefined),
      describe: async ({ invoice }) => {
        const id = heldId(invoice);
        const why = d.held().find((h) => h.id === id)!.reason;
        return `I would accept the held offer on invoice ${short(id)} and pay it from your wallet. I held it because: ${why}`;
      },
      run: async ({ invoice }) => ({ text: await d.acceptHeld(heldId(invoice)) }),
    },
    {
      name: "list_payments",
      description: "list your upcoming payments (payroll, bills) that I protect cash for",
      args: empty,
      match: (t) => (/^(list|show)?\s*(my\s+)?(upcoming\s+)?(payments|payroll|bills|obligations)\??$/i.test(t) ? {} : undefined),
      run: async () => {
        const rows = d.payments();
        return { text: rows.length ? rows.map((r) => `${r.label} (${r.kind}): ${formatUsd(r.amount)} due ${date(r.dueSec)}`).join("\n") : "No upcoming payments are listed.", data: rows.map((r) => ({ ...r, amount: r.amount.toString() })) };
      },
    },
    {
      name: "add_payment",
      description: "add an upcoming payment I must keep cash for: a label, an amount in USDC and a due date (YYYY-MM-DD)",
      args: z.strictObject({
        label: z.string().min(1).max(60),
        amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "the amount is a plain USDC number such as 3000 or 1250.50"),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "the date is YYYY-MM-DD"),
        kind: z.enum(["payroll", "bill", "other"]).default("other"),
      }),
      confirm: true,
      // "add payment payroll 3000 on 2026-11-01"
      match: (t) => {
        const m = /^add (?:a )?(?:upcoming )?payment\s+(.+?)\s+(\d[\d,]*(?:\.\d+)?)\s+(?:on|due|by)?\s*(\d{4}-\d{2}-\d{2})\s*$/i.exec(t);
        if (!m) return undefined;
        const label = m[1]!;
        return { label, amount: m[2]!.replace(/,/g, ""), due_date: m[3]!, kind: /payroll|salary|wage/i.test(label) ? "payroll" : /rent|bill|tax|utility|insurance/i.test(label) ? "bill" : "other" };
      },
      describe: ({ label, amount, due_date }) => `I would add an upcoming payment "${label}" of ${formatUsd(toMinor(amount))} due ${due_date}. It stays in my encrypted store on your machine, and I will keep that cash back from early payments.`,
      run: async ({ label, amount, due_date, kind }) => {
        const dueSec = Math.floor(Date.parse(`${due_date}T00:00:00Z`) / 1000);
        if (!Number.isFinite(dueSec)) throw new Error("that is not a real date");
        return { text: d.addPayment({ label, amount: toMinor(amount), dueSec, kind }) };
      },
    },
  ];
}

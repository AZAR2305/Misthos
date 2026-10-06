import type { Hex } from "viem";
import { formatMinor } from "./core";
import type { InvoiceRecord } from "./chain/invoices";

/**
 * Double-entry journal for settled invoices (CLAUDE.md P9 templates, plus the success fee). Debits always equal credits.
 * Buyer:    Dr Accounts payable (face)  Dr Protocol fees (fee)   Cr Cash (net + fee)  Cr Early-payment discounts earned (discount)
 * Supplier: Dr Cash (net)  Dr Early-payment discount expense (discount)   Cr Accounts receivable (face)
 */
export type Side = "buyer" | "supplier";

export interface JournalLine {
  invoiceId: Hex;
  tx: Hex;
  block: bigint;
  account: string;
  debit: bigint;
  credit: bigint;
  memo: string;
}

export function journalFor(side: Side, inv: InvoiceRecord): JournalLine[] {
  const s = inv.settled;
  if (!s) return [];
  const base = { invoiceId: inv.id, tx: s.tx, block: s.block };
  const memo = s.kind === "early" ? `Paid early at ${s.rateBps / 100}%` : "Paid on the due date";
  const line = (account: string, debit: bigint, credit: bigint): JournalLine => ({ ...base, account, debit, credit, memo });
  const out: JournalLine[] =
    side === "buyer"
      ? [
          line("Accounts payable", inv.amount, 0n),
          ...(s.fee > 0n ? [line("Protocol fees", s.fee, 0n)] : []),
          line("Cash (USDC)", 0n, s.net + s.fee),
          ...(s.discount > 0n ? [line("Early-payment discounts earned", 0n, s.discount)] : []),
        ]
      : [
          line("Cash (USDC)", s.net, 0n),
          ...(s.discount > 0n ? [line("Early-payment discount expense", s.discount, 0n)] : []),
          line("Accounts receivable", 0n, inv.amount),
        ];
  return out;
}

/** Journal for a wallet, across the invoices where it is the given side. */
export function journalFrom(side: Side, invoices: readonly InvoiceRecord[], me: string): JournalLine[] {
  const mine = invoices.filter((i) => (side === "buyer" ? i.buyer : i.supplier) === me.toLowerCase());
  return mine.flatMap((i) => journalFor(side, i));
}

export function balanced(lines: readonly JournalLine[]): boolean {
  const byInvoice = new Map<Hex, bigint>();
  for (const l of lines) byInvoice.set(l.invoiceId, (byInvoice.get(l.invoiceId) ?? 0n) + l.debit - l.credit);
  return [...byInvoice.values()].every((v) => v === 0n);
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

export function toCsv(lines: readonly JournalLine[], time: (block: bigint) => number | undefined): string {
  const head = ["date", "invoice", "account", "debit", "credit", "memo", "tx"];
  const rows = lines.map((l) => {
    const t = time(l.block);
    return [t ? day(t) : "", l.invoiceId, l.account, formatMinor(l.debit), formatMinor(l.credit), l.memo, l.tx].map(csvCell).join(",");
  });
  return [head.join(","), ...rows].join("\n") + "\n";
}

const BC: Record<string, string> = {
  "Accounts payable": "Liabilities:AccountsPayable",
  "Accounts receivable": "Assets:AccountsReceivable",
  "Cash (USDC)": "Assets:Cash:USDC",
  "Protocol fees": "Expenses:ProtocolFees",
  "Early-payment discounts earned": "Income:EarlyPaymentDiscounts",
  "Early-payment discount expense": "Expenses:EarlyPaymentDiscounts",
};

/** One balanced beancount transaction per settlement. Run `bean-check` on the result before importing it anywhere. */
export function toBeancount(lines: readonly JournalLine[], time: (block: bigint) => number | undefined): string {
  const groups = new Map<Hex, JournalLine[]>();
  for (const l of lines) groups.set(l.invoiceId, [...(groups.get(l.invoiceId) ?? []), l]);
  const accounts = new Set<string>();
  const entries: Array<{ date: string; text: string }> = [];
  for (const [id, ls] of groups) {
    const t = time(ls[0]!.block);
    const date = t ? day(t) : "1970-01-01";
    const postings = ls.map((l) => {
      const acct = BC[l.account]!;
      accounts.add(acct);
      const amount = l.debit > 0n ? l.debit : -l.credit;
      const text = formatMinor(amount);
      return `  ${acct.padEnd(34)} ${text.padStart(16)} USDC`;
    });
    entries.push({
      date,
      text: `${date} * "Misthos" "${ls[0]!.memo} (${id.slice(0, 10)}…)"\n  tx: "${ls[0]!.tx}"\n${postings.join("\n")}`,
    });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = entries[0]?.date ?? "1970-01-01";
  const opens = [...accounts].sort().map((a) => `${first} open ${a} USDC`);
  return [`option "operating_currency" "USDC"`, "", ...opens, "", ...entries.map((e) => e.text)].join("\n") + "\n";
}

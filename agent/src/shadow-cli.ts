import { readFileSync } from "node:fs";
import { SHADOW_LABEL, parseDateSec, parseInvoicesCsv, parseObligationsCsv, shadowReport, shadowToCsv, shadowToMarkdown, toMinor } from "./core/index.js";

/**
 * Shadow report from the terminal: what a buyer's agent WOULD do with your real invoices and cash. Same decision code as the agents; no model, no network, nothing stored.
 *   pnpm --filter @misthos/agent shadow --invoices invoices.csv --cash 12000 [--floor 5000] [--hurdle 0] [--obligations payments.csv] [--as-of 2026-10-14] [--csv]
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function fail(lines: string[]): never {
  console.error(lines.join("\n"));
  process.exit(1);
}

const file = arg("invoices");
const cash = arg("cash");
if (!file || cash === undefined) fail(["Usage: shadow --invoices invoices.csv --cash 12000 [--floor 5000] [--hurdle 0] [--obligations payments.csv] [--as-of YYYY-MM-DD] [--csv]", "Columns of the invoices file: counterparty,amount,due_date,approved_date[,offer_rate_pct]"]);

const nowSec = parseDateSec(arg("as-of") ?? new Date().toISOString().slice(0, 10));
if (nowSec === undefined) fail(["--as-of must be a real date in the form YYYY-MM-DD."]);
const hurdle = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(arg("hurdle") ?? "0");
if (!hurdle) fail(["--hurdle is a yearly percentage from 0 to 50 with at most two decimals."]);

const inv = parseInvoicesCsv(readFileSync(file, "utf8"), nowSec);
const obl = parseObligationsCsv(arg("obligations") ? readFileSync(arg("obligations")!, "utf8") : "");
const errors = [...inv.errors.map((e) => `invoices, line ${e.line}: ${e.message}`), ...obl.errors.map((e) => `payments, line ${e.line}: ${e.message}`)];
if (errors.length) fail(["Nothing was computed. Fix these first:", ...errors]);

const report = shadowReport({
  nowSec,
  cash: toMinor(cash),
  policy: { hurdleAprBps: Number(hurdle[1]) * 100 + Number((hurdle[2] ?? "").padEnd(2, "0") || "0"), liquidityFloor: toMinor(arg("floor") ?? "0"), perInvoiceCap: 0n, dailyCap: 0n, humanAbove: 0n, feeBps: 1000 },
  invoices: inv.rows,
  obligations: obl.rows,
  includeUnselectedDue: !flag("spare-cash-only"),
});
console.log(flag("csv") ? shadowToCsv(report) : shadowToMarkdown(report));
console.error(SHADOW_LABEL);

import { allocate, fitsCashPath, MAX_INVOICES, type Obligation } from "./allocator";
import { SECONDS_PER_DAY, formatMinor, toMinor, MoneyError } from "./money";
import { evaluateOffer, REASON_TEXT, type BuyerPolicy, type Candidate, type ReasonCode } from "./policy";
import { discountOf, priceOffer } from "./pricing";

/**
 * SHADOW MODE: what the buyer's agent WOULD do with a real business's real invoices and cash. It runs the same decision code the agents run
 * (`evaluateOffer`, `fitsCashPath` for each offer as it arrives, `allocate` for the best set). No model is involved, no network is used, nothing is
 * stored, and no funds move. A shadow report is a computation on the owner's own data; it is NOT on-chain activity and never counts as traction.
 *
 * Pure: it reads no clock and does no I/O. The caller says what "now" is.
 */
export const SHADOW_LABEL = "Shadow report: computation on your data. No funds moved.";
export const SHADOW_SOURCE = "shadow" as const;

/** Factoring's typical yearly cost, from docs/MARKET_RESEARCH.md (sellers' own sites: indicative, not a quote). */
export const DEFAULT_FACTORING_APR_BPS = 2600;
export const MAX_SHADOW_ROWS = MAX_INVOICES;

export interface RowError {
  /** 1-based line number in the text the person pasted, header included. */
  line: number;
  message: string;
}

export interface ShadowInvoiceRow {
  line: number;
  /** A label for display only. It never reaches a model, a server or a log. */
  counterparty: string;
  face: bigint;
  dueSec: bigint;
  /** When the buyer approved it. Empty means not approved yet, so it cannot be paid early. */
  approvedSec?: bigint;
  /** The supplier's posted offer, if known. Otherwise the report assumes the buyer's hurdle. */
  offerRateBps?: number;
}
export interface ShadowObligationRow {
  line: number;
  label: string;
  amount: bigint;
  dueSec: bigint;
}

// ---------------------------------------------------------------------------------------------------- CSV

/** One CSV line into fields. Handles double quotes (with "" as an escaped quote) and nothing fancier. */
function splitCsvLine(line: string): string[] | null {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') (cur += '"'), i++;
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === ",") (out.push(cur.trim()), (cur = ""));
    else cur += ch;
  }
  if (quoted) return null;
  out.push(cur.trim());
  return out;
}

/** "2026-11-14" into UTC midnight, in seconds. Rejects anything that is not a real calendar date. */
export function parseDateSec(s: string): bigint | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return undefined;
  return BigInt(Math.floor(t / 1000));
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 80);

function parseTable(text: string, wanted: readonly string[], optional: readonly string[]): { header: string[]; lines: { n: number; cells: string[] }[]; errors: RowError[]; headerBad: boolean } {
  const errors: RowError[] = [];
  let headerBad = false;
  const raw = text.replace(/^﻿/, "").split(/\r?\n/);
  const lines: { n: number; cells: string[] }[] = [];
  let header: string[] | undefined;
  raw.forEach((l, i) => {
    if (!l.trim()) return;
    const cells = splitCsvLine(l);
    if (!cells) return void errors.push({ line: i + 1, message: "A quoted value is not closed." });
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      const known = new Set([...wanted, ...optional]);
      for (const c of header) if (!known.has(c)) (headerBad = true), errors.push({ line: i + 1, message: `Unknown column "${clean(c)}". Expected: ${[...wanted, ...optional].join(", ")}.` });
      for (const w of wanted) if (!header.includes(w)) (headerBad = true), errors.push({ line: i + 1, message: `Missing column "${w}".` });
      return;
    }
    if (cells.length !== header.length) return void errors.push({ line: i + 1, message: `This row has ${cells.length} values but the header has ${header.length}.` });
    lines.push({ n: i + 1, cells });
  });
  if (!header) (headerBad = true), errors.push({ line: 1, message: "No header row. Start with: " + [...wanted, ...optional].join(",") });
  return { header: header ?? [], lines, errors, headerBad };
}

/**
 * Columns: counterparty, amount (USDC, up to 6 decimals), due_date (YYYY-MM-DD), approved_date (YYYY-MM-DD, empty if not approved yet), offer_rate_pct (optional,
 * 0 to 50). The due date means the start of that day in UTC, which is slightly conservative. A malformed row is reported by line; nothing is guessed or skipped.
 */
export function parseInvoicesCsv(text: string, nowSec: bigint): { rows: ShadowInvoiceRow[]; errors: RowError[] } {
  const t = parseTable(text, ["counterparty", "amount", "due_date", "approved_date"], ["offer_rate_pct"]);
  const errors = [...t.errors];
  const rows: ShadowInvoiceRow[] = [];
  if (!t.headerBad) {
    const col = (name: string) => t.header.indexOf(name);
    for (const { n, cells } of t.lines) {
      const bad = (message: string) => errors.push({ line: n, message });
      const label = clean(cells[col("counterparty")]!);
      if (!label) { bad("counterparty is empty."); continue; }
      let face: bigint;
      try {
        face = toMinor(cells[col("amount")]!);
      } catch (e) {
        bad((e as MoneyError).message);
        continue;
      }
      if (face <= 0n) { bad("amount must be above zero."); continue; }
      const due = parseDateSec(cells[col("due_date")]!);
      if (due === undefined) { bad(`due_date "${clean(cells[col("due_date")]!)}" is not a real date in the form YYYY-MM-DD.`); continue; }
      const apprRaw = cells[col("approved_date")]!;
      const appr = apprRaw === "" ? undefined : parseDateSec(apprRaw);
      if (apprRaw !== "" && appr === undefined) { bad(`approved_date "${clean(apprRaw)}" is not a real date in the form YYYY-MM-DD (leave it empty if not approved yet).`); continue; }
      let rate: number | undefined;
      const ri = col("offer_rate_pct");
      if (ri >= 0 && cells[ri] !== "") {
        const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(cells[ri]!);
        const bps = m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0") : NaN;
        if (!Number.isFinite(bps) || bps > 5000) { bad(`offer_rate_pct "${clean(cells[ri]!)}" must be 0 to 50 with at most two decimals.`); continue; }
        rate = bps;
      }
      rows.push({ line: n, counterparty: label, face, dueSec: due, ...(appr !== undefined ? { approvedSec: appr } : {}), ...(rate !== undefined ? { offerRateBps: rate } : {}) });
    }
    errors.sort((a, b) => a.line - b.line);
    if (rows.length === 0 && errors.length === 0) errors.push({ line: 1, message: "There are no invoice rows." });
    if (rows.length > MAX_SHADOW_ROWS) errors.push({ line: rows[MAX_SHADOW_ROWS]!.line, message: `At most ${MAX_SHADOW_ROWS} invoices per report (the exact search is limited). Split the list by due date.` });
  }
  void nowSec;
  return { rows: errors.length ? [] : rows, errors };
}

/** Columns: label, amount, due_date. The label is for display only. */
export function parseObligationsCsv(text: string): { rows: ShadowObligationRow[]; errors: RowError[] } {
  if (!text.trim()) return { rows: [], errors: [] };
  const t = parseTable(text, ["label", "amount", "due_date"], []);
  const errors = [...t.errors];
  const rows: ShadowObligationRow[] = [];
  if (!t.headerBad) {
    const col = (name: string) => t.header.indexOf(name);
    for (const { n, cells } of t.lines) {
      const bad = (message: string) => errors.push({ line: n, message });
      let amount: bigint;
      try {
        amount = toMinor(cells[col("amount")]!);
      } catch (e) {
        bad((e as MoneyError).message);
        continue;
      }
      const due = parseDateSec(cells[col("due_date")]!);
      if (amount <= 0n) { bad("amount must be above zero."); continue; }
      if (due === undefined) { bad(`due_date "${clean(cells[col("due_date")]!)}" is not a real date in the form YYYY-MM-DD.`); continue; }
      rows.push({ line: n, label: clean(cells[col("label")]!), amount, dueSec: due });
    }
    errors.sort((a, b) => a.line - b.line);
  }
  return { rows: errors.length ? [] : rows, errors };
}

// ---------------------------------------------------------------------------------------------------- the report

export interface ShadowInput {
  /** The date the report is "as of", in seconds. */
  nowSec: bigint;
  cash: bigint;
  policy: BuyerPolicy;
  invoices: readonly ShadowInvoiceRow[];
  obligations: readonly ShadowObligationRow[];
  /** Count every unpaid approved invoice as a payment that falls due (the default, spec 8.3). False looks only at spare cash and the obligations. */
  includeUnselectedDue?: boolean;
  factoringAprBps?: number;
}

export interface ShadowLine {
  line: number;
  counterparty: string;
  decision: "accelerate" | "hold";
  /** Why a held invoice is held, as one of the agent's own reason codes, with the same fixed sentence. */
  reasonCode?: ReasonCode;
  reason?: string;
  rateBps: number;
  /** One decimal place, as text (integer arithmetic). "0.0" when held. */
  daysGained: string;
  face: bigint;
  discount: bigint;
  net: bigint;
  fee: bigint;
  /** What the supplier would have paid to be financed over the same days at the factoring rate, and what they keep by being paid this way. */
  factoringCost: bigint;
  supplierKeepsVsFactoring: bigint;
}

export interface ShadowReport {
  source: typeof SHADOW_SOURCE;
  label: typeof SHADOW_LABEL;
  asOfSec: bigint;
  lines: ShadowLine[];
  totals: { accelerated: number; held: number; face: bigint; discount: bigint; net: bigint; fee: bigint; outflow: bigint; factoringCost: bigint; supplierKeepsVsFactoring: bigint; avgDaysGained: string };
  /** The optimiser's best set for the same inputs, for comparison with the arrival-order result above. */
  best: { ids: number[]; totalDiscount: bigint; greedyIds: number[]; greedyDiscount: bigint; explanation: string; baselineBreach: boolean };
  assumptions: string[];
}

const tenths = (seconds: bigint) => {
  const t = (seconds * 10n) / SECONDS_PER_DAY;
  return `${t / 10n}.${t % 10n}`;
};

export function shadowReport(input: ShadowInput): ShadowReport {
  const { nowSec, cash, policy } = input;
  const includeDue = input.includeUnselectedDue ?? true;
  const factoring = input.factoringAprBps ?? DEFAULT_FACTORING_APR_BPS;
  if (input.invoices.length > MAX_SHADOW_ROWS) throw new RangeError(`At most ${MAX_SHADOW_ROWS} invoices per report.`);

  // One candidate per invoice, exactly as the agent would see an offer: approved or not, with its rate.
  const cand = new Map<number, Candidate>();
  for (const r of input.invoices) {
    cand.set(r.line, {
      id: `row-${r.line}`,
      face: r.face,
      dueSec: r.dueSec,
      status: r.approvedSec !== undefined && r.approvedSec <= nowSec ? "approved" : "registered",
      offerRateBps: r.offerRateBps ?? policy.hurdleAprBps,
      offerExpirySec: nowSec + SECONDS_PER_DAY,
    });
  }
  const obligations: Obligation[] = input.obligations.map((o) => ({ id: `obl-${o.line}`, dueSec: o.dueSec, amount: o.amount }));

  // Offers arrive in the order the invoices were approved (then by due date). Each is decided with the SAME per-offer function the agent uses,
  // against the cash left after what it already paid, with the invoices not yet paid still falling due.
  const order = [...input.invoices].sort((a, b) => {
    const ka = a.approvedSec ?? a.dueSec;
    const kb = b.approvedSec ?? b.dueSec;
    return ka === kb ? (a.dueSec === b.dueSec ? a.line - b.line : a.dueSec < b.dueSec ? -1 : 1) : ka < kb ? -1 : 1;
  });
  let cashNow = cash;
  let spentToday = 0n;
  const unpaid = new Map(cand);
  const lines = new Map<number, ShadowLine>();
  for (const r of order) {
    const c = cand.get(r.line)!;
    const secondsEarly = c.dueSec - nowSec;
    const base = { line: r.line, counterparty: r.counterparty, rateBps: c.offerRateBps, face: r.face };
    const hold = (reasonCode: ReasonCode): ShadowLine => ({ ...base, decision: "hold", reasonCode, reason: REASON_TEXT[reasonCode], daysGained: "0.0", discount: 0n, net: 0n, fee: 0n, factoringCost: 0n, supplierKeepsVsFactoring: 0n });
    const ev = evaluateOffer(policy, c, nowSec);
    if (!ev.ok) {
      lines.set(r.line, hold(ev.reason));
      continue;
    }
    const fits = fitsCashPath({ nowSec, cash: cashNow, policy, obligations, candidates: [...unpaid.values()], includeUnselectedDue: includeDue, spentToday }, c.id);
    if (!fits) {
      lines.set(r.line, hold("LIQUIDITY_FLOOR"));
      continue;
    }
    const p = priceOffer(c.face, c.offerRateBps, secondsEarly, policy.feeBps);
    cashNow -= p.outflow;
    spentToday += p.outflow;
    unpaid.delete(r.line);
    const factoringCost = discountOf(c.face, factoring, secondsEarly);
    lines.set(r.line, { ...base, decision: "accelerate", daysGained: tenths(secondsEarly), discount: p.discount, net: p.net, fee: p.fee, factoringCost, supplierKeepsVsFactoring: factoringCost > p.discount ? factoringCost - p.discount : 0n });
  }

  const out = input.invoices.map((r) => lines.get(r.line)!);
  const done = out.filter((l) => l.decision === "accelerate");
  const sum = (f: (l: ShadowLine) => bigint) => done.reduce((a, l) => a + f(l), 0n);
  const weightedSeconds = done.reduce((a, l) => a + (cand.get(l.line)!.dueSec - nowSec) * l.face, 0n);
  const totalFace = sum((l) => l.face);

  // The optimiser's best set, for comparison. It maximises the discount, so with a zero rate it finds nothing to gain and may pick no one; that
  // is not a "no": every invoice that fits is paid above, one by one, at no cost to the supplier.
  const all = [...cand.values()];
  const idToLine = (id: string) => Number(id.slice(4));
  const best = allocate({ nowSec, cash, policy, obligations, candidates: all, includeUnselectedDue: includeDue });

  const assumptions = [
    "Invoices are judged one at a time in the order they were approved, the way your agent sees offers arrive, each against the cash left after the ones it already paid.",
    input.invoices.some((r) => r.offerRateBps === undefined)
      ? `Where a row has no offer rate, the offer is assumed to be your hurdle (${(policy.hurdleAprBps / 100).toFixed(2)}% a year): the lowest rate you would accept. A real supplier's ladder starts at 0% and climbs, so it may clear at a different rate.`
      : "Every row has its own offer rate.",
    "Due dates count as the start of that day in UTC, which is slightly conservative.",
    `The factoring comparison assumes ${(factoring / 100).toFixed(0)}% a year, from sellers' own published figures (docs/MARKET_RESEARCH.md): an indicative figure, not a quote.`,
    "No model was used and nothing left this page: the decisions are the same code your agent runs.",
    "This is a computation on the data you entered. No funds moved, nothing was signed, and it is not on-chain activity.",
  ];

  return {
    source: SHADOW_SOURCE,
    label: SHADOW_LABEL,
    asOfSec: nowSec,
    lines: out,
    totals: {
      accelerated: done.length,
      held: out.length - done.length,
      face: totalFace,
      discount: sum((l) => l.discount),
      net: sum((l) => l.net),
      fee: sum((l) => l.fee),
      outflow: sum((l) => l.net + l.fee),
      factoringCost: sum((l) => l.factoringCost),
      supplierKeepsVsFactoring: sum((l) => l.supplierKeepsVsFactoring),
      avgDaysGained: totalFace === 0n ? "0.0" : tenths(weightedSeconds / totalFace),
    },
    best: { ids: best.ids.map(idToLine), totalDiscount: best.totalDiscount, greedyIds: best.greedy.ids.map(idToLine), greedyDiscount: best.greedy.totalDiscount, explanation: best.explanation, baselineBreach: best.baselineBreach },
    assumptions,
  };
}

// ---------------------------------------------------------------------------------------------------- export

const csvCell = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""'); // a leading =, +, - or @ would run as a formula in a spreadsheet

/** The report as a CSV. The label is the first line, so it travels with the file. Counterparty text is neutralised against spreadsheet formulas. */
export function shadowToCsv(r: ShadowReport): string {
  const head = ["line", "counterparty", "decision", "reason", "rate_pct", "days_gained", "face_usdc", "discount_usdc", "net_usdc", "fee_usdc", "supplier_keeps_vs_factoring_usdc"];
  const rows = r.lines.map((l) => [l.line, `"${csvCell(l.counterparty)}"`, l.decision, `"${csvCell(l.reason ?? "")}"`, (l.rateBps / 100).toFixed(2), l.daysGained, formatMinor(l.face), formatMinor(l.discount), formatMinor(l.net), formatMinor(l.fee), formatMinor(l.supplierKeepsVsFactoring)].join(","));
  return [`# ${r.label}`, `# source=${r.source}`, head.join(","), ...rows].join("\n") + "\n";
}

/** The report as Markdown for a person to read or paste. */
export function shadowToMarkdown(r: ShadowReport): string {
  const d = (s: bigint) => formatMinor(s);
  const t = r.totals;
  return [
    `**${r.label}**`,
    "",
    `Source: ${r.source}. As of ${new Date(Number(r.asOfSec) * 1000).toISOString().slice(0, 10)}.`,
    "",
    `Your agent would pay **${t.accelerated}** of ${t.accelerated + t.held} invoices early and hold ${t.held}. Face value paid early: ${d(t.face)} USDC, on average ${t.avgDaysGained} days early. You would earn ${d(t.discount)} USDC in discount (platform fee ${d(t.fee)} USDC). The suppliers would keep about ${d(t.supplierKeepsVsFactoring)} USDC compared with factoring.`,
    "",
    "| Line | Counterparty | Decision | Rate | Days early | Face | Discount | Why held |",
    "|---|---|---|---|---|---|---|---|",
    ...r.lines.map((l) => `| ${l.line} | ${l.counterparty.replace(/\|/g, "/")} | ${l.decision} | ${(l.rateBps / 100).toFixed(2)}% | ${l.daysGained} | ${d(l.face)} | ${d(l.discount)} | ${l.reason ?? ""} |`),
    "",
    "Assumptions:",
    ...r.assumptions.map((a) => `- ${a}`),
    "",
  ].join("\n");
}

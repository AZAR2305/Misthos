import { formatUsd } from "./money.js";
import { discountOf, feeOf } from "./pricing.js";
import { evaluateOffer, type BuyerPolicy, type Candidate, type ReasonCode } from "./policy.js";

/** Spec 8.3: exact search for at most 20 invoices. More than that fails closed; filter before calling. */
export const MAX_INVOICES = 20;

export interface Obligation {
  id: string;
  dueSec: bigint;
  amount: bigint;
}

export interface AllocatorInput {
  nowSec: bigint;
  /** Treasury balance now (ERC-20 balanceOf, 6 decimals). */
  cash: bigint;
  policy: BuyerPolicy;
  obligations: readonly Obligation[];
  /** Every approved invoice the buyer owes, with its current posted offer. Ineligible ones still fall due. */
  candidates: readonly Candidate[];
  /** Net + fee already paid early today, against the on-chain daily cap. Default 0. */
  spentToday?: bigint;
  /**
   * Spec 8.3 subtracts the face of every unselected invoice that falls due from the cash path (default true).
   * Set false to look only at today's spare cash and the obligations, which is what Appendix B's allocator
   * fixture does (it gives "cash above floor" and no payables schedule).
   */
  includeUnselectedDue?: boolean;
}

export interface Priced {
  id: string;
  dueSec: bigint;
  face: bigint;
  rateBps: number;
  discount: bigint;
  net: bigint;
  fee: bigint;
  outflow: bigint;
}

export interface CashPoint {
  tSec: bigint;
  baseline: bigint;
  accelerated: bigint;
}

export interface Exclusion {
  id: string;
  reason: ReasonCode;
  detail: string;
}

export interface Plan {
  ids: string[];
  totalDiscount: bigint;
  totalNet: bigint;
  totalFee: bigint;
  totalOutflow: bigint;
}

export interface Allocation extends Plan {
  /** The chosen invoices with per-invoice pricing. */
  items: Priced[];
  excluded: Exclusion[];
  /** Eligible but above the human sign-off amount: shown on /buyer/approvals instead of auto-settling. */
  needsApproval: string[];
  greedy: Plan;
  cashPath: CashPoint[];
  /** True when the cash path is under the liquidity floor even if nothing is paid early. */
  baselineBreach: boolean;
  /** Written from validated numbers only. No model involved. */
  explanation: string;
}

export class AllocatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocatorError";
  }
}

function price(c: Candidate, nowSec: bigint, feeBps: number): Priced {
  const discount = discountOf(c.face, c.offerRateBps, c.dueSec - nowSec);
  const net = c.face - discount;
  const fee = feeOf(discount, feeBps);
  return { id: c.id, dueSec: c.dueSec, face: c.face, rateBps: c.offerRateBps, discount, net, fee, outflow: net + fee };
}

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** Lexicographic comparison of sorted due dates, earliest first. */
function compareDue(a: bigint[], b: bigint[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = cmp(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return 0;
}

interface Best {
  picked: number[];
  discount: bigint;
  dues: bigint[];
}

export function allocate(input: AllocatorInput): Allocation {
  const { nowSec, cash, policy, obligations, candidates } = input;
  const includeDue = input.includeUnselectedDue ?? true;
  const spentToday = input.spentToday ?? 0n;

  // 1. Eligibility. Code decides; a model can only remove an invoice by raising a flag that code confirms.
  const excluded: Exclusion[] = [];
  const needsApproval: string[] = [];
  let selectable: Priced[] = [];
  for (const c of candidates) {
    const ev = evaluateOffer(policy, c, nowSec);
    if (ev.ok) selectable.push(price(c, nowSec, policy.feeBps));
    else {
      excluded.push({ id: c.id, reason: ev.reason, detail: ev.detail });
      if (ev.reason === "NEEDS_HUMAN_APPROVAL") needsApproval.push(c.id);
    }
  }
  if (selectable.length > MAX_INVOICES) {
    throw new AllocatorError(`More than ${MAX_INVOICES} eligible invoices. Narrow the list first.`);
  }
  selectable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 2. Cash path events: today, every obligation, every approved invoice that falls due.
  const payables = candidates.filter((c) => c.status === "approved" && c.dueSec > nowSec);
  const when = (o: Obligation) => (o.dueSec < nowSec ? nowSec : o.dueSec);
  const times = new Set<bigint>([nowSec]);
  for (const o of obligations) times.add(when(o));
  if (includeDue) for (const p of payables) times.add(p.dueSec);
  const ts = [...times].sort(cmp);
  const K = ts.length;

  const baseline: bigint[] = ts.map((t) => {
    let b = cash;
    for (const o of obligations) if (when(o) <= t) b -= o.amount;
    if (includeDue) for (const p of payables) if (p.dueSec <= t) b -= p.face;
    return b;
  });

  const dailyRoom = policy.dailyCap > 0n ? policy.dailyCap - spentToday : null;
  if (dailyRoom !== null && dailyRoom < 0n) {
    for (const s of selectable) {
      excluded.push({ id: s.id, reason: "NOT_ELIGIBLE", detail: "Above your daily cap." });
    }
    selectable = [];
  }

  // delta[i][k]: how much choosing invoice i lowers the cash path at event k (paying early also removes the
  // face that would otherwise fall due, so later events can recover).
  const delta: bigint[][] = selectable.map((s) => ts.map((t) => s.outflow - (includeDue && s.dueSec <= t ? s.face : 0n)));

  const floor = policy.liquidityFloor;
  const feasible = (cum: readonly bigint[]) => {
    for (let k = 0; k < K; k++) if (baseline[k]! - cum[k]! < floor) return false;
    return true;
  };

  // 3. Exact search: maximise total discount; ties by fewer invoices, then earlier due dates.
  const n = selectable.length;
  const cum: bigint[] = new Array<bigint>(K).fill(0n);
  const picked: number[] = [];
  let best: Best | null = null;

  const consider = (discount: bigint) => {
    if (!feasible(cum)) return;
    const dues = picked.map((i) => selectable[i]!.dueSec).sort(cmp);
    let better = best === null;
    if (best !== null) {
      if (discount !== best.discount) better = discount > best.discount;
      else if (picked.length !== best.picked.length) better = picked.length < best.picked.length;
      else better = compareDue(dues, best.dues) < 0;
    }
    if (better) best = { picked: [...picked], discount, dues };
  };

  const dfs = (i: number, discount: bigint, outflow: bigint) => {
    if (i === n) {
      consider(discount);
      return;
    }
    dfs(i + 1, discount, outflow); // exclude i
    const s = selectable[i]!;
    // Day-0 outflow only grows as invoices are added, so it can prune; later events can recover, so they cannot.
    if (cum[0]! + delta[i]![0]! > baseline[0]! - floor) return;
    if (dailyRoom !== null && outflow + s.outflow > dailyRoom) return;
    for (let k = 0; k < K; k++) cum[k]! += delta[i]![k]!;
    picked.push(i);
    dfs(i + 1, discount + s.discount, outflow + s.outflow);
    picked.pop();
    for (let k = 0; k < K; k++) cum[k]! -= delta[i]![k]!;
  };
  dfs(0, 0n, 0n);

  const chosenIdx = best ? (best as Best).picked.slice().sort((a, b) => a - b) : [];
  const items = chosenIdx.map((i) => selectable[i]!);
  const plan = summarise(items);

  // 4. Greedy-by-rate, for comparison (the explanation says why the optimiser beats it).
  const byRate = selectable
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.rateBps - a.s.rateBps || (a.s.id < b.s.id ? -1 : 1));
  const gCum: bigint[] = new Array<bigint>(K).fill(0n);
  const gItems: Priced[] = [];
  let gOutflow = 0n;
  for (const { s, i } of byRate) {
    const next = gCum.map((v, k) => v + delta[i]![k]!);
    if (!feasible(next)) continue;
    if (dailyRoom !== null && gOutflow + s.outflow > dailyRoom) continue;
    for (let k = 0; k < K; k++) gCum[k] = next[k]!;
    gOutflow += s.outflow;
    gItems.push(s);
  }
  const greedy = summarise(gItems);

  // 5. Cash path of the chosen plan.
  const chosenCum: bigint[] = new Array<bigint>(K).fill(0n);
  for (const i of chosenIdx) for (let k = 0; k < K; k++) chosenCum[k]! += delta[i]![k]!;
  const cashPath: CashPoint[] = ts.map((t, k) => ({
    tSec: t,
    baseline: baseline[k]!,
    accelerated: baseline[k]! - chosenCum[k]!,
  }));
  const baselineBreach = baseline.some((b) => b < floor);

  // 6. Why not the rest.
  const chosenIds = new Set(items.map((s) => s.id));
  for (const s of selectable) {
    if (!chosenIds.has(s.id)) {
      excluded.push({
        id: s.id,
        reason: "LIQUIDITY_FLOOR",
        detail: "Not selected: the chosen set earns more within your cash and floor.",
      });
    }
  }

  return {
    ...plan,
    items,
    excluded,
    needsApproval,
    greedy,
    cashPath,
    baselineBreach,
    explanation: explain(plan, greedy, cash - floor, baselineBreach),
  };
}

function summarise(items: readonly Priced[]): Plan {
  let totalDiscount = 0n;
  let totalNet = 0n;
  let totalFee = 0n;
  for (const s of items) {
    totalDiscount += s.discount;
    totalNet += s.net;
    totalFee += s.fee;
  }
  return { ids: items.map((s) => s.id), totalDiscount, totalNet, totalFee, totalOutflow: totalNet + totalFee };
}

function explain(plan: Plan, greedy: Plan, spare: bigint, breach: boolean): string {
  if (plan.ids.length === 0) {
    return breach
      ? "Nothing to pay early: your cash path is already under the liquidity floor."
      : "Nothing to pay early: no eligible offer fits your cash and floor.";
  }
  const chosen = plan.ids.join("+");
  if (greedy.ids.length > 0 && greedy.totalDiscount < plan.totalDiscount) {
    return `${chosen} beats ${greedy.ids.join("+")}: ${formatUsd(plan.totalDiscount)} vs ${formatUsd(greedy.totalDiscount)} with ${formatUsd(spare)} of cash above the floor.`;
  }
  return `${chosen} earns ${formatUsd(plan.totalDiscount)}. Greedy by rate picks the same set.`;
}

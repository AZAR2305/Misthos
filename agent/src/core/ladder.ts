import { MAX_RATE_BPS } from "./pricing.js";

export interface SupplierPrefs {
  /** The supplier's own cost of waiting (a card APR, for example). Default 2200. */
  costOfWaitingAprBps: number;
  maxRateBps: number;
  /** Used when there is not enough history with this buyer. Default 0. */
  startRateBps: number;
  stepBps: number;
}

export const DEFAULT_PREFS: SupplierPrefs = {
  costOfWaitingAprBps: 2200,
  maxRateBps: MAX_RATE_BPS,
  startRateBps: 0,
  stepBps: 200,
};

/** Never price within this margin of the supplier's cost of waiting (spec 8.2). */
export const COST_MARGIN_BPS = 200;
/** The ladder is short (spec 8.2: 3 to 6 rungs). */
export const MAX_RUNGS = 6;

/** The ceiling of the ladder: min(prefs.maxRate, costOfWaiting - 200 bps, MAX_RATE_BPS), never below zero. */
export function maxRate(prefs: SupplierPrefs): number {
  return Math.max(0, Math.min(prefs.maxRateBps, prefs.costOfWaitingAprBps - COST_MARGIN_BPS, MAX_RATE_BPS));
}

/** Nearest-rank percentile of a list of rates (p in 0..1). Appendix B: [400, 600, 600] at p25 gives 400. */
export function nearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError("no values");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1]!;
}

/**
 * Adaptive start (spec 8.2): with at least three past accepted rates with this buyer, start at their nearest-rank
 * p25, clamped to [0, maxRate]; otherwise start at prefs.startRateBps.
 */
export function startRate(prefs: SupplierPrefs, pastAcceptedBps: readonly number[]): number {
  const ceiling = maxRate(prefs);
  const raw = pastAcceptedBps.length >= 3 ? nearestRank(pastAcceptedBps, 0.25) : prefs.startRateBps;
  return Math.min(Math.max(raw, 0), ceiling);
}

/**
 * Rungs: start, start + step, ... capped at maxRate. If that would be more than MAX_RUNGS, the step is widened so
 * the ladder stays short and still ends at the ceiling. Always returns at least one rung.
 */
export function buildLadder(prefs: SupplierPrefs, pastAcceptedBps: readonly number[] = []): number[] {
  const start = startRate(prefs, pastAcceptedBps);
  const ceiling = maxRate(prefs);
  if (start >= ceiling) return [start];
  let step = Math.max(1, prefs.stepBps);
  const naive = Math.floor((ceiling - start) / step) + 1;
  if (naive > MAX_RUNGS) step = Math.ceil((ceiling - start) / (MAX_RUNGS - 1));
  const rungs: number[] = [];
  for (let r = start; r <= ceiling && rungs.length < MAX_RUNGS; r += step) rungs.push(r);
  return rungs;
}

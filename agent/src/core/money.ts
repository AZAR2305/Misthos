/**
 * Money is a bigint in USDC minor units (6 decimals). There is no float math on money anywhere in this package
 * (CLAUDE.md 0.2). Strings are converted at the edge only.
 */
export const USDC_DECIMALS = 6;
export const ONE_USDC = 1_000_000n;
export const SECONDS_PER_DAY = 86_400n;
export const SECONDS_PER_YEAR = 365n * SECONDS_PER_DAY;
export const BPS = 10_000n;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** "2000.00" -> 2_000_000_000n. Rejects more than 6 decimals, signs, exponents and blanks. */
export function toMinor(input: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!m) throw new MoneyError(`Not a USDC amount: "${input}". Use digits with up to 6 decimals.`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0") || "0");
  return whole * ONE_USDC + frac;
}

/** 1_985_205_480n -> "1985.205480" (full precision) */
export function formatMinor(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / ONE_USDC;
  const frac = (abs % ONE_USDC).toString().padStart(USDC_DECIMALS, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** UI formatting: 2 decimals, thousands separators, rounded half up. Display only. */
export function formatUsd(minor: bigint, dp = 2): string {
  const scale = 10n ** BigInt(USDC_DECIMALS - dp);
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const rounded = (abs + scale / 2n) / scale;
  const unit = 10n ** BigInt(dp);
  const whole = (rounded / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (rounded % unit).toString().padStart(dp, "0");
  return `${neg ? "-" : ""}$${whole}${dp > 0 ? "." + frac : ""}`;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

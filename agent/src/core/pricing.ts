import { BPS, SECONDS_PER_YEAR } from "./money";

/** Hard ceilings mirrored from InvoiceBook.sol. Keep in sync with the contract. */
export const MAX_RATE_BPS = 5000;
export const MAX_FEE_BPS = 3000;
export const DEFAULT_FEE_BPS = 1000;

/** discount = floor(amount * rateBps * secondsEarly / (10_000 * 365 * 86_400)). Same formula as the contract. */
export function discountOf(amount: bigint, rateBps: number, secondsEarly: bigint): bigint {
  if (amount < 0n || secondsEarly < 0n || rateBps < 0) throw new RangeError("negative pricing input");
  return (amount * BigInt(rateBps) * secondsEarly) / (BPS * SECONDS_PER_YEAR);
}

export function netOf(amount: bigint, discount: bigint): bigint {
  return amount - discount;
}

/** Protocol success fee: a share of the discount, floored. Zero when the discount is zero. */
export function feeOf(discount: bigint, feeBps: number): bigint {
  return (discount * BigInt(feeBps)) / BPS;
}

export interface Pricing {
  discount: bigint;
  net: bigint;
  fee: bigint;
  /** What the buyer's wallet pays in total: net + fee. */
  outflow: bigint;
}

export function priceOffer(amount: bigint, rateBps: number, secondsEarly: bigint, feeBps = DEFAULT_FEE_BPS): Pricing {
  const discount = discountOf(amount, rateBps, secondsEarly);
  if (discount >= amount) throw new RangeError("discount must stay below the face amount");
  const net = netOf(amount, discount);
  const fee = feeOf(discount, feeBps);
  return { discount, net, fee, outflow: net + fee };
}

/**
 * What the buyer earns, annualised, in basis points (display only):
 * (discount / net) * (365 days / secondsEarly) * 10_000, floored.
 */
export function effectiveAprBps(discount: bigint, net: bigint, secondsEarly: bigint): bigint {
  if (net <= 0n || secondsEarly <= 0n) return 0n;
  return (discount * BPS * SECONDS_PER_YEAR) / (net * secondsEarly);
}

/** What waiting costs the supplier at its own cost-of-waiting APR (a card or overdraft). Same formula as the discount. */
export function costOfWaiting(amount: bigint, aprBps: number, secondsEarly: bigint): bigint {
  return discountOf(amount, aprBps, secondsEarly);
}

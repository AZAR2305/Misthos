/** JSON for the API: bigint becomes a decimal string (USDC amounts are 6-decimal minor units), never a float. */
export function ser<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x)));
}

/** USDC minor units (bigint) to the exact decimal string Postgres numeric(20,6) wants, and back. No floats. */
export function toNumeric(minor: bigint): string {
  const neg = minor < 0n;
  const a = neg ? -minor : minor;
  return `${neg ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0")}`;
}
export function fromNumeric(s: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`not a numeric: ${s}`);
  const v = BigInt(m[2]!) * 1_000_000n + BigInt((m[3] ?? "").padEnd(6, "0").slice(0, 6) || "0");
  return m[1] ? -v : v;
}

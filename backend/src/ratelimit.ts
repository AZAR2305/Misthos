import type { MiddlewareHandler } from "hono";

/**
 * A small in-memory limiter for the endpoints that guess at secrets or cost real work: sign-in, wallet linking and claim
 * links. It counts requests per client in a sliding window. One process only: behind several instances put the limit at the
 * proxy as well. The client is the first X-Forwarded-For entry only when TRUST_PROXY is set; otherwise the socket address.
 */
export function rateLimit(o: { limit: number; windowMs: number; trustProxy: boolean; now?: () => number; group: string }): MiddlewareHandler {
  const hits = new Map<string, number[]>();
  const clock = o.now ?? Date.now;
  let sweep = 0;
  return async (c, next) => {
    const t = clock();
    const fwd = o.trustProxy ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
    const socket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
    // Keyed by the route GROUP, never the full path: a code or token sits in the path, and a guesser who changes it must not get a fresh allowance.
    const key = `${fwd ?? socket ?? "local"}:${o.group}`;
    const recent = (hits.get(key) ?? []).filter((x) => t - x < o.windowMs);
    if (recent.length >= o.limit) {
      const retry = Math.max(1, Math.ceil((o.windowMs - (t - recent[0]!)) / 1000));
      c.header("retry-after", String(retry));
      return c.json({ ok: false, data: null, error: { code: "RATE_LIMITED", message: `Too many tries. Wait ${retry} seconds and try again.` } }, 429);
    }
    recent.push(t);
    hits.set(key, recent);
    // Forget clients that have gone quiet so the map cannot grow without bound.
    if (++sweep % 500 === 0) for (const [k, v] of hits) if (t - v[v.length - 1]! > o.windowMs) hits.delete(k);
    await next();
  };
}

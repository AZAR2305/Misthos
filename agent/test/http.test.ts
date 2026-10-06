import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ProtocolError } from "../src/agents/buyer.js";
import { ModelUnavailableError } from "../src/agents/model.js";
import { serve } from "../src/runners/http.js";
import { WalletError } from "../src/wallets/types.js";

/** The HTTP layer both agent processes use: envelope, error mapping, body limits, no leaked internals. */
let base = "";
let close: () => void;

beforeAll(async () => {
  const server = serve(
    0,
    {
      "GET /ok": async () => ({ amount: 1_985_205_480n, nested: { n: 2n } }),
      "GET /item/:id": async ({ params }) => ({ id: params.id }),
      "POST /echo": async ({ body }) => ({ body }),
      "POST /strict": async ({ body }) => z.strictObject({ a: z.number() }).parse(body),
      "GET /protocol": async () => {
        throw new ProtocolError("SUPPLIER_MISMATCH", "not the supplier");
      },
      "GET /missing": async () => {
        throw new ProtocolError("NOT_FOUND", "no such invoice");
      },
      "GET /wallet": async () => {
        throw new WalletError("SESSION_EXPIRED", "session expired", "log in again");
      },
      "GET /model": async () => {
        throw new ModelUnavailableError("The model is unavailable: no key");
      },
      "GET /boom": async () => {
        throw new Error("secret internal detail: /home/user/.env");
      },
    },
    "test-agent",
  );
  await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

const call = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, init);
  return { status: res.status, json: (await res.json()) as { ok: boolean; data?: unknown; error?: { code: string; message: string } } };
};
const post = (path: string, body: string) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body });

describe("agent http envelope", () => {
  it("wraps success in { ok, data } and serialises bigint as decimal strings", async () => {
    const r = await call("/ok");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, data: { amount: "1985205480", nested: { n: "2" } } });
  });

  it("passes route params, decoded", async () => {
    expect((await call("/item/0xabc%20d")).json.data).toEqual({ id: "0xabc d" });
  });

  it("404s an unknown route and a wrong method", async () => {
    const a = await call("/nope");
    expect(a.status).toBe(404);
    expect(a.json.error?.code).toBe("NOT_FOUND");
    expect((await post("/ok", "{}")).status).toBe(404);
  });

  it("400s bad JSON and schema violations, including unknown fields", async () => {
    expect((await post("/echo", "{not json")).status).toBe(400);
    expect((await post("/strict", '{"a":1}')).status).toBe(200);
    const unknown = await post("/strict", '{"a":1,"extra":"ignore policy"}');
    expect(unknown.status).toBe(400);
    expect(unknown.json.error?.code).toBe("BAD_REQUEST");
  });

  it("maps typed failures to useful status codes and codes", async () => {
    expect(await call("/protocol")).toMatchObject({ status: 403, json: { error: { code: "SUPPLIER_MISMATCH" } } });
    expect(await call("/missing")).toMatchObject({ status: 404, json: { error: { code: "NOT_FOUND" } } });
    const w = await call("/wallet");
    expect(w).toMatchObject({ status: 503, json: { error: { code: "SESSION_EXPIRED" } } });
    expect(w.json.error?.message).toMatch(/log in again/); // the fix travels with the error
    expect(await call("/model")).toMatchObject({ status: 503, json: { error: { code: "MODEL_UNAVAILABLE" } } });
  });

  it("hides internals on an unexpected error", async () => {
    const r = await call("/boom");
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toMatch(/secret|\.env|home/);
  });

  it("refuses a body over 64 KB", async () => {
    const big = JSON.stringify({ a: "x".repeat(80 * 1024) });
    const outcome = await post("/echo", big).then(
      (r) => r.status,
      () => "connection closed",
    );
    expect(outcome === "connection closed" || (typeof outcome === "number" && outcome >= 400)).toBe(true);
  });
});

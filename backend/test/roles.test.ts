/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { domain, invoiceTypedData } from "../src/shared";
import { browser, makeApp, signIn, wallet } from "./helpers";

/**
 * A wallet is the one role the RoleRegistry recorded for it on chain, for good. The chain RPC is a stand-in that answers roleOf from a table the
 * test controls (and can be made to fail); everything else is the real API and database.
 */
const BOOK = "0x00000000000000000000000000000000000000b1" as const;
const REG = "0x00000000000000000000000000000000000000c2" as const;
const D = domain(5042002, BOOK);
const TOKEN = "0x3600000000000000000000000000000000000000" as const;
const SUPPLIER = wallet(1);
const BUYER = wallet(2);
const id = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(32);

function world(roles: Record<string, 0 | 1 | 2>, o: { down?: () => boolean } = {}) {
  const client = {
    getBlockNumber: async () => 1n,
    verifyTypedData: async () => false,
    readContract: async (a: { functionName: string; args: unknown[] }) => {
      if (a.functionName === "roleOf") {
        if (o.down?.()) throw new Error("rpc down");
        return roles[String(a.args[0]).toLowerCase()] ?? 0;
      }
      return [0n, 0n, 0n, 0n, 0n, 0n, 0]; // InvoiceBook.invoices: not registered yet
    },
  } as never;
  return makeApp({ env: { INVOICE_BOOK_ADDRESS: BOOK, ROLE_REGISTRY_ADDRESS: REG }, client, relayer: {} as never });
}
const key = (w: { address: string }) => w.address.toLowerCase();

describe("a wallet's side is its fixed on-chain role", () => {
  it("a wallet with no role on chain cannot choose a side here: it must register on Arc first", async () => {
    const { app } = await world({});
    const b = browser(app);
    await signIn(b, 1);
    const r = await b.put("/api/me/side", { side: "supplier" });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("ROLE_NOT_REGISTERED");
    expect((await b.get("/api/me")).json.data.side).toBeNull();
  });

  it("the registered role is accepted, and any other side is refused for good, even with confirm", async () => {
    const { app } = await world({ [key(SUPPLIER)]: 1 });
    const b = browser(app);
    await signIn(b, 1);
    expect((await b.put("/api/me/side", { side: "supplier" })).json.data.side).toBe("supplier");
    for (const body of [{ side: "buyer" }, { side: "buyer", confirm: true }]) {
      const r = await b.put("/api/me/side", body);
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("ROLE_LOCKED");
      expect(r.json.error.message).toMatch(/registered on chain as a supplier, and that cannot be changed/);
    }
    expect((await b.get("/api/me")).json.data.side).toBe("supplier");
  });

  it("reconnecting the same wallet, in a fresh browser, comes back as the same role with no choice to make", async () => {
    const { app } = await world({ [key(BUYER)]: 2 });
    const first = browser(app);
    await signIn(first, 2);
    await first.put("/api/me/side", { side: "buyer" });
    first.clear(); // signed out, cookie gone
    const again = browser(app);
    const s = await signIn(again, 2);
    expect(s.json.data).toMatchObject({ side: "buyer", step: "ready" });
    // and a wallet that registered on chain before ever visiting this site gets its role on the very first sign-in
    const { app: app2 } = await world({ [key(SUPPLIER)]: 1 });
    expect((await signIn(browser(app2), 1)).json.data).toMatchObject({ side: "supplier", step: "ready" });
  });

  it("an unreadable registry changes nothing and says so, never a guess", async () => {
    let down = false;
    const { app } = await world({}, { down: () => down });
    const b = browser(app);
    await signIn(b, 1);
    down = true;
    const r = await b.put("/api/me/side", { side: "supplier" });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("CHAIN_UNAVAILABLE");
    expect((await b.get("/api/me")).json.data.side).toBeNull();
  });
});

describe("the relayer only registers an invoice between a registered supplier and a registered buyer", () => {
  const post = async (w: Awaited<ReturnType<typeof world>>, b: ReturnType<typeof browser>, nonce: number) => {
    const invoice = { supplier: SUPPLIER.address, buyer: BUYER.address, token: TOKEN, amount: 1_000_000_000n, dueDate: BigInt(Math.floor(Date.now() / 1000) + 40 * 86400), refHash: id(nonce) as `0x${string}`, nonce: BigInt(nonce) };
    const signature = await SUPPLIER.signTypedData(invoiceTypedData(D, invoice) as never);
    void w;
    return b.post("/api/relay/register", { invoice: { ...invoice, amount: invoice.amount.toString(), dueDate: invoice.dueDate.toString(), nonce: invoice.nonce.toString() }, signature });
  };

  it("works when the roles are right", async () => {
    const w = await world({ [key(SUPPLIER)]: 1, [key(BUYER)]: 2 });
    const b = browser(w.app);
    await signIn(b, 1);
    await b.put("/api/me/side", { side: "supplier" });
    expect((await post(w, b, 1)).status).toBe(202);
  });

  it("refuses a buyer who has not registered, and a buyer who registered as a supplier", async () => {
    for (const [buyerRole, text] of [[0, /has not registered as a buyer/], [1, /registered as a supplier, so it cannot be the buyer/]] as const) {
      const w = await world({ [key(SUPPLIER)]: 1, [key(BUYER)]: buyerRole });
      const b = browser(w.app);
      await signIn(b, 1);
      await b.put("/api/me/side", { side: "supplier" });
      const r = await post(w, b, 2);
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("ROLE_MISMATCH");
      expect(r.json.error.message).toMatch(text);
    }
  });

  it("with no registry configured, nothing changes: no role is claimed or enforced", async () => {
    const { app } = await makeApp();
    const b = browser(app);
    await signIn(b, 1);
    expect((await b.put("/api/me/side", { side: "supplier" })).json.data.side).toBe("supplier");
    expect((await b.put("/api/me/side", { side: "buyer", confirm: true })).json.data.side).toBe("buyer"); // the old behaviour, unchanged
    expect((await browser(app).get("/api/health")).json.data.roleRegistry).toEqual({ configured: false, address: null });
  });

  it("health reports the registry", async () => {
    const { app } = await world({});
    expect((await browser(app).get("/api/health")).json.data.roleRegistry).toEqual({ configured: true, address: REG });
  });
});

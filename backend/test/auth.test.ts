import { describe, expect, it } from "vitest";
import { ORIGIN, browser, makeApp, onboard, signIn, wallet } from "./helpers";

describe("account onboarding: sign in with a wallet, then choose a side", () => {
  it("runs the whole flow with a real wallet signature and keeps the session in an HttpOnly cookie", async () => {
    const { app } = await makeApp();
    const b = browser(app);
    expect((await b.get("/api/me")).json.data).toBeNull();

    const w = wallet(1);
    // No session is needed to ask for the message: nobody has an account yet.
    const ch = await b.post("/api/auth/wallet/challenge", { address: w.address });
    expect(ch.status).toBe(200);
    // EIP-4361: domain, wallet, URI, version, chain id, nonce, issued-at and expiry are all in the message
    const msg = ch.json.data.message as string;
    expect(msg.startsWith(`${new URL(ORIGIN).host} wants you to sign in with your Ethereum account:
${w.address}`)).toBe(true);
    for (const field of [`URI: ${ORIGIN}`, "Version: 1", "Chain ID: ", `Nonce: ${ch.json.data.nonce}`, "Issued At: ", "Expiration Time: "]) expect(msg, field).toContain(field);
    expect(msg).not.toMatch(/@/);

    // A signature from a different key is refused, and the challenge stays usable.
    const wrong = await wallet(5).signMessage({ message: ch.json.data.message });
    const bad = await b.post("/api/auth/wallet/signin", { address: w.address, nonce: ch.json.data.nonce, signature: wrong });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("BAD_SIGNATURE");
    expect((await b.get("/api/me")).json.data).toBeNull();

    const sig = await w.signMessage({ message: ch.json.data.message });
    const ok = await b.post("/api/auth/wallet/signin", { address: w.address, nonce: ch.json.data.nonce, signature: sig });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ address: w.address.toLowerCase(), side: null, step: "side" });
    expect(ok.json.data.email).toBeUndefined();
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    // A challenge is single use.
    const again = await browser(app).post("/api/auth/wallet/signin", { address: w.address, nonce: ch.json.data.nonce, signature: sig });
    expect(again.json.error.code).toBe("BAD_CHALLENGE");

    const side = await b.put("/api/me/side", { side: "supplier" });
    expect(side.json.data).toMatchObject({ side: "supplier", step: "ready" });
    expect((await b.get("/api/me")).json.data).toMatchObject({ side: "supplier", address: w.address.toLowerCase() });

    // Switching needs an explicit confirm.
    expect((await b.put("/api/me/side", { side: "buyer" })).json.error.code).toBe("CONFIRM_REQUIRED");
    expect((await b.put("/api/me/side", { side: "buyer", confirm: true })).json.data.side).toBe("buyer");

    await b.post("/api/auth/logout");
    expect((await b.get("/api/me")).json.data).toBeNull();
  });

  it("one wallet is one account: signing in again returns the same account, a new wallet makes a new one", async () => {
    const { app } = await makeApp();
    const a = browser(app);
    const first = await onboard(a, null, { walletIndex: 1, side: "supplier" });

    const back = await signIn(browser(app), 1);
    expect(back.json.data).toMatchObject({ id: first.id, side: "supplier", step: "ready" });

    const other = await signIn(browser(app), 2);
    expect(other.json.data.id).not.toBe(first.id);
    expect(other.json.data).toMatchObject({ side: null, step: "side" });
  });

  it("refuses writes without a session and from a foreign origin", async () => {
    const { app } = await makeApp();
    const anon = browser(app);
    expect((await anon.put("/api/me/side", { side: "buyer" })).status).toBe(401);
    expect((await anon.get("/api/exposure-policy")).status).toBe(401);

    const evil = await anon.post("/api/auth/wallet/challenge", { address: wallet(1).address }, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.json.error.code).toBe("BAD_ORIGIN");
  });

  it("expires sessions and challenges", async () => {
    let t = new Date("2026-10-07T10:00:00Z");
    const { app } = await makeApp({ now: () => t });
    const b = browser(app);
    const w = wallet(2);
    const ch = await b.post("/api/auth/wallet/challenge", { address: w.address });
    const sig = await w.signMessage({ message: ch.json.data.message });

    t = new Date(t.getTime() + 11 * 60_000); // past the 10 minute challenge
    expect((await b.post("/api/auth/wallet/signin", { address: w.address, nonce: ch.json.data.nonce, signature: sig })).json.error.code).toBe("BAD_CHALLENGE");

    await signIn(b, 2); // a fresh challenge at the new time works
    t = new Date(t.getTime() + 15 * 86_400_000); // past the 14 day session
    expect((await b.get("/api/me")).json.data).toBeNull();
  });

  it("a signature for one address cannot sign in as another", async () => {
    const { app } = await makeApp();
    const b = browser(app);
    const ch = await b.post("/api/auth/wallet/challenge", { address: wallet(1).address });
    const sig = await wallet(1).signMessage({ message: ch.json.data.message });
    const r = await b.post("/api/auth/wallet/signin", { address: wallet(2).address, nonce: ch.json.data.nonce, signature: sig });
    expect(r.json.error.code).toBe("BAD_CHALLENGE");
  });

  it("names the site in the message, so a signature made on another site is not valid here", async () => {
    const { app } = await makeApp();
    const ch = await browser(app).post("/api/auth/wallet/challenge", { address: wallet(1).address });
    expect(ch.json.data.message).toContain(`URI: ${ORIGIN}`);
    expect(ch.json.data.message).toContain(`${new URL(ORIGIN).host} wants you to sign in`);
  });

  it("keeps no private value on the server: the old private-settings routes are gone", async () => {
    const { app } = await makeApp();
    const buyer = browser(app);
    const supplier = browser(app);
    await onboard(buyer, null, { walletIndex: 2, side: "buyer" });
    await onboard(supplier, null, { walletIndex: 1, side: "supplier" });
    // A buyer's hurdle, floor, caps and payment calendar, and a supplier's cost of waiting, stay with the owning agent.
    for (const [who, method, path] of [[buyer, "get", "/api/policy"], [buyer, "get", "/api/obligations"], [supplier, "get", "/api/prefs"]] as const) {
      expect((await who[method](path)).status, path).toBe(404);
    }
    expect((await buyer.put("/api/policy", { hurdleAprBps: 800, liquidityFloor: "5000000000", perInvoiceCap: "0", dailyCap: "0", humanAbove: "0" })).status).toBe(404);
    expect((await buyer.post("/api/obligations", { label: "Payroll", amount: "12000000000", dueDate: "2026-11-01T00:00:00.000Z", kind: "payroll" })).status).toBe(404);
    expect((await supplier.put("/api/prefs", { costOfWaitingAprBps: 2200, maxRateBps: 1200, startRateBps: 0, stepBps: 200 })).status).toBe(404);
  });

  it("scopes the exposure (risk) limit, the one policy the server keeps, to the account's own side", async () => {
    const { app } = await makeApp();
    const buyer = browser(app);
    await onboard(buyer, null, { walletIndex: 2, side: "buyer" });
    const anon = browser(app);
    expect((await anon.get("/api/exposure-policy")).status).toBe(401);
    expect((await buyer.get("/api/exposure-policy")).status).toBe(200);
  });

  it("sends restrictive security headers on every answer, including errors", async () => {
    const { app } = await makeApp();
    for (const path of ["/api/health", "/api/me", "/api/nope"]) {
      const res = await app.request(path, { headers: { origin: ORIGIN } });
      expect(res.headers.get("content-security-policy"), path).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("strict-transport-security"), path).toMatch(/max-age=/);
      expect(res.headers.get("referrer-policy"), path).toBe("no-referrer");
    }
  });

  it("answers CORS only for the configured origin", async () => {
    const { app } = await makeApp();
    const ok = await app.request("/api/health", { headers: { origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    const no = await app.request("/api/health", { headers: { origin: "https://evil.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("limits how fast anyone can hammer sign-in", async () => {
    const { app } = await makeApp({ env: { RATE_LIMIT_PER_MIN: "5" } });
    const b = browser(app);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await b.post("/api/auth/wallet/challenge", { address: wallet(1).address })).status);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
    expect((await b.get("/api/health")).status).toBe(200); // other routes are not affected
  });
});

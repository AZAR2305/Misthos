import { describe, expect, it } from "vitest";
import { createGoogleVerifier } from "../src/auth";
import { CLIENT_ID, ORIGIN, browser, fakeGoogle, makeApp, onboard, wallet } from "./helpers";

describe("Google ID token verification", () => {
  it("accepts a good token and rejects every bad one", async () => {
    const g = await fakeGoogle();
    const verify = createGoogleVerifier({ clientId: CLIENT_ID, issuers: ["https://accounts.google.com"], jwksUrl: "https://example.invalid/certs", keys: g.keys });
    const profile = await verify(await g.sign({ sub: "1", email: "Ada@Example.com", name: "Ada" }));
    expect(profile).toEqual({ sub: "1", email: "ada@example.com", name: "Ada" });

    await expect(verify(await g.forged({ sub: "1", email: "a@b.co" }))).rejects.toMatchObject({ code: "BAD_GOOGLE_TOKEN" });
    await expect(verify(await g.sign({ sub: "1", email: "a@b.co" }, { aud: "someone-elses-client" }))).rejects.toMatchObject({ code: "BAD_GOOGLE_TOKEN" });
    await expect(verify(await g.sign({ sub: "1", email: "a@b.co" }, { iss: "https://evil.example" }))).rejects.toMatchObject({ code: "BAD_GOOGLE_TOKEN" });
    await expect(verify(await g.sign({ sub: "1", email: "a@b.co" }, { exp: "-1h" }))).rejects.toMatchObject({ code: "BAD_GOOGLE_TOKEN" });
    await expect(verify(await g.sign({ sub: "1", email: "a@b.co", email_verified: false }))).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    await expect(verify("not-a-jwt")).rejects.toMatchObject({ code: "BAD_GOOGLE_TOKEN" });
  });
});

describe("account onboarding: Google, then a wallet, then a side", () => {
  it("runs the whole flow with a real wallet signature and keeps the session in an HttpOnly cookie", async () => {
    const { app, google } = await makeApp();
    const b = browser(app);

    expect((await b.get("/api/me")).json.data).toBeNull();

    const credential = await google.sign({ sub: "g-1", email: "ada@example.com", name: "Ada" });
    const signIn = await b.post("/api/auth/google", { credential });
    expect(signIn.status).toBe(200);
    expect(signIn.json.data).toMatchObject({ email: "ada@example.com", side: null, address: null, step: "wallet" });
    const cookie = signIn.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    // Choosing a side before linking a wallet is refused.
    expect((await b.put("/api/me/side", { side: "supplier" })).json.error.code).toBe("WALLET_REQUIRED");

    const w = wallet(1);
    const ch = await b.post("/api/auth/wallet/challenge", { address: w.address });
    expect(ch.status).toBe(200);
    expect(ch.json.data.message).toContain(w.address.toLowerCase());
    expect(ch.json.data.message).toContain("ada@example.com");

    // A signature from a different key is refused, and the challenge stays usable.
    const wrong = await wallet(5).signMessage({ message: ch.json.data.message });
    const bad = await b.post("/api/auth/wallet/bind", { address: w.address, nonce: ch.json.data.nonce, signature: wrong });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("BAD_SIGNATURE");

    const ok = await b.post("/api/auth/wallet/bind", {
      address: w.address,
      nonce: ch.json.data.nonce,
      signature: await w.signMessage({ message: ch.json.data.message }),
    });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ address: w.address.toLowerCase(), step: "side" });

    // A challenge is single use.
    const again = await b.post("/api/auth/wallet/bind", { address: w.address, nonce: ch.json.data.nonce, signature: await w.signMessage({ message: ch.json.data.message }) });
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

  it("links one wallet to one account only, and one Google identity to one account only", async () => {
    const { app, google } = await makeApp();
    const a = browser(app);
    const c = browser(app);
    await onboard(a, google, { sub: "g-a", email: "a@example.com", walletIndex: 1, side: "supplier" });

    // A second Google account cannot claim the same wallet.
    const cred = await google.sign({ sub: "g-c", email: "c@example.com" });
    await c.post("/api/auth/google", { credential: cred });
    const w = wallet(1);
    const ch = await c.post("/api/auth/wallet/challenge", { address: w.address });
    const taken = await c.post("/api/auth/wallet/bind", { address: w.address, nonce: ch.json.data.nonce, signature: await w.signMessage({ message: ch.json.data.message }) });
    expect(taken.status).toBe(409);
    expect(taken.json.error.code).toBe("ADDRESS_TAKEN");

    // The same Google identity signing in again is the same account, not a new one.
    const again = browser(app);
    const back = await again.post("/api/auth/google", { credential: await google.sign({ sub: "g-a", email: "a@example.com" }) });
    expect(back.json.data).toMatchObject({ side: "supplier", address: w.address.toLowerCase(), step: "ready" });
  });

  it("refuses writes without a session, from a foreign origin, and without a Google client id", async () => {
    const { app, google } = await makeApp();
    const anon = browser(app);
    expect((await anon.post("/api/auth/wallet/challenge", { address: wallet(1).address })).status).toBe(401);
    expect((await anon.put("/api/me/side", { side: "buyer" })).status).toBe(401);
    expect((await anon.get("/api/policy")).status).toBe(401);

    const cred = await google.sign({ sub: "x", email: "x@example.com" });
    const evil = await anon.post("/api/auth/google", { credential: cred }, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.json.error.code).toBe("BAD_ORIGIN");

    const closed = await makeApp({ env: { GOOGLE_CLIENT_ID: "" } });
    // Built without a verifier on purpose: the route must say "unavailable", not pretend.
    const noGoogle = (await import("../src/api")).createApp({ config: closed.config, db: closed.db });
    const r = await browser(noGoogle).post("/api/auth/google", { credential: "x".repeat(30) });
    expect(r.status).toBe(503);
    expect(r.json.error.message).toMatch(/^Unavailable: Google sign-in is not configured/);
  });

  it("expires sessions and challenges", async () => {
    let t = new Date("2026-10-07T10:00:00Z");
    const { app, google } = await makeApp({ now: () => t });
    const b = browser(app);
    await b.post("/api/auth/google", { credential: await google.sign({ sub: "s", email: "s@example.com" }) });
    const w = wallet(2);
    const ch = await b.post("/api/auth/wallet/challenge", { address: w.address });
    const sig = await w.signMessage({ message: ch.json.data.message });

    t = new Date(t.getTime() + 11 * 60_000); // past the 10 minute challenge
    expect((await b.post("/api/auth/wallet/bind", { address: w.address, nonce: ch.json.data.nonce, signature: sig })).json.error.code).toBe("BAD_CHALLENGE");

    t = new Date(t.getTime() + 15 * 86_400_000); // past the 14 day session
    expect((await b.get("/api/me")).json.data).toBeNull();
  });

  it("scopes private settings to the account's side and organisation", async () => {
    const { app, google } = await makeApp();
    const buyer = browser(app);
    const supplier = browser(app);
    await onboard(buyer, google, { sub: "b", email: "buyer@example.com", walletIndex: 2, side: "buyer" });
    await onboard(supplier, google, { sub: "s", email: "supplier@example.com", walletIndex: 1, side: "supplier" });

    expect((await supplier.get("/api/policy")).json.error.code).toBe("WRONG_SIDE");
    expect((await buyer.get("/api/prefs")).json.error.code).toBe("WRONG_SIDE");

    expect((await buyer.get("/api/policy")).json.data).toBeNull(); // nothing saved yet: no invented defaults
    const put = await buyer.put("/api/policy", { hurdleAprBps: 800, liquidityFloor: "5000000000", perInvoiceCap: "2000000000", dailyCap: "0", humanAbove: "1000000000" });
    expect(put.status).toBe(200);
    expect((await buyer.get("/api/policy")).json.data).toEqual({ hurdleAprBps: 800, liquidityFloor: "5000000000", perInvoiceCap: "2000000000", dailyCap: "0", humanAbove: "1000000000" });
    expect((await buyer.put("/api/policy", { hurdleAprBps: 9000, liquidityFloor: "0", perInvoiceCap: "0", dailyCap: "0", humanAbove: "0" })).status).toBe(400);

    const ob = await buyer.post("/api/obligations", { label: "Payroll", amount: "12000000000", dueDate: "2026-11-01T00:00:00.000Z", kind: "payroll" });
    expect(ob.status).toBe(201);
    expect((await buyer.get("/api/obligations")).json.data).toHaveLength(1);
    expect((await buyer.del(`/api/obligations/${ob.json.data.id}`)).json.data.deleted).toBe(true);

    expect((await supplier.get("/api/prefs")).json.data).toBeNull();
    expect((await supplier.put("/api/prefs", { costOfWaitingAprBps: 2200, maxRateBps: 1200, startRateBps: 0, stepBps: 200 })).status).toBe(200);
    expect((await supplier.get("/api/prefs")).json.data).toEqual({ costOfWaitingAprBps: 2200, maxRateBps: 1200, startRateBps: 0, stepBps: 200 });
  });

  it("answers CORS only for the configured origin", async () => {
    const { app } = await makeApp();
    const ok = await app.request("/api/health", { headers: { origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    const no = await app.request("/api/health", { headers: { origin: "https://evil.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
});

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { mnemonicToAccount } from "viem/accounts";
import { createApp, type AppDeps } from "../src/api";
import { createGoogleVerifier } from "../src/auth";
import { loadConfig } from "../src/config";
import { migrate, openDb, type Db } from "../src/db";

export const MNEMONIC = "test test test test test test test test test test test junk";
export const wallet = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });

export const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
export const ORIGIN = "http://localhost:3000";

/**
 * A stand-in for Google: our own RSA key signs ID tokens, and the verifier is pointed at that key's public half. The
 * verification code under test is the production code; only the key set differs (as it would with a different issuer).
 */
export async function fakeGoogle() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const other = await generateKeyPair("RS256");
  const sign = (claims: Record<string, unknown>, o: { key?: typeof privateKey; aud?: string; iss?: string; exp?: string } = {}) =>
    new SignJWT({ email_verified: true, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(o.iss ?? "https://accounts.google.com")
      .setAudience(o.aud ?? CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? "1h")
      .sign(o.key ?? privateKey);
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    sign,
    /** A token signed by a key the verifier does not trust. */
    forged: (claims: Record<string, unknown>) => sign(claims, { key: other.privateKey }),
  };
}

export async function makeApp(extra: Partial<AppDeps> & { env?: Record<string, string> } = {}) {
  const config = loadConfig({ DATABASE_URL: "pglite://memory", FRONTEND_ORIGINS: ORIGIN, GOOGLE_CLIENT_ID: CLIENT_ID, ...extra.env });
  const db: Db = extra.db ?? (await openDb("pglite://memory"));
  await migrate(db);
  const g = await fakeGoogle();
  const google = createGoogleVerifier({ clientId: CLIENT_ID, issuers: config.ISSUERS, jwksUrl: config.GOOGLE_JWKS_URL, keys: g.keys });
  const app = createApp({ config, db, google, ...extra });
  return { app, db, config, google: g };
}

/** A browser-like caller: keeps the session cookie between requests and always sends the page's Origin. */
export function browser(app: ReturnType<typeof createApp>) {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!.endsWith("=") ? "" : set.split(";")[0]!;
    const text = await res.text();
    let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      json = JSON.parse(text);
    } catch {
      /* csv etc. */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (p: string) => call("GET", p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => call("POST", p, b ?? {}, h),
    put: (p: string, b?: unknown) => call("PUT", p, b ?? {}),
    del: (p: string) => call("DELETE", p),
    clear: () => (cookie = ""),
  };
}

/** What the page does: ask the server for a nonce, have Google embed it in a signed token, post the token back. */
export async function login(b: ReturnType<typeof browser>, google: Awaited<ReturnType<typeof fakeGoogle>>, profile: { sub: string; email: string; name?: string }) {
  const n = await b.get("/api/auth/nonce");
  const credential = await google.sign({ ...profile, nonce: n.json.data.nonce });
  return b.post("/api/auth/google", { credential });
}

/** Signs in with a Google token and links + chooses, the whole onboarding, using a real wallet signature. */
export async function onboard(
  b: ReturnType<typeof browser>,
  google: Awaited<ReturnType<typeof fakeGoogle>>,
  o: { sub: string; email: string; walletIndex: number; side: "supplier" | "buyer" },
) {
  const s = await login(b, google, { sub: o.sub, email: o.email, name: o.email.split("@")[0] });
  if (s.status !== 200) throw new Error(`sign-in failed: ${s.text}`);
  const w = wallet(o.walletIndex);
  const ch = await b.post("/api/auth/wallet/challenge", { address: w.address });
  const signature = await w.signMessage({ message: ch.json.data.message });
  const bound = await b.post("/api/auth/wallet/bind", { address: w.address, nonce: ch.json.data.nonce, signature });
  if (bound.status !== 200) throw new Error(`bind failed: ${bound.text}`);
  const side = await b.put("/api/me/side", { side: o.side });
  if (side.status !== 200) throw new Error(`side failed: ${side.text}`);
  return side.json.data;
}

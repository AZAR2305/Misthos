import { mnemonicToAccount } from "viem/accounts";
import { createApp, type AppDeps } from "../src/api";
import { loadConfig } from "../src/config";
import { migrate, openDb, type Db } from "../src/db";

export const MNEMONIC = "test test test test test test test test test test test junk";
export const wallet = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });

export const ORIGIN = "http://localhost:3000";

export async function makeApp(extra: Partial<AppDeps> & { env?: Record<string, string> } = {}) {
  const config = loadConfig({ DATABASE_URL: "pglite://memory", FRONTEND_ORIGINS: ORIGIN, ...extra.env });
  const db: Db = extra.db ?? (await openDb("pglite://memory"));
  await migrate(db);
  const app = createApp({ config, db, ...extra });
  /** `google` stays in the result as null so older call sites that destructure it keep compiling; there is no Google any more. */
  return { app, db, config, google: null };
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

/** What the page does: ask for a one-time message, sign it with the wallet, post the signature back. Starts the session. */
export async function signIn(b: ReturnType<typeof browser>, walletIndex: number) {
  const w = wallet(walletIndex);
  const ch = await b.post("/api/auth/wallet/challenge", { address: w.address });
  const signature = await w.signMessage({ message: ch.json.data.message });
  return b.post("/api/auth/wallet/signin", { address: w.address, nonce: ch.json.data.nonce, signature });
}

/** Signs in with a wallet signature and chooses a side: the whole onboarding. (_google, sub and email are ignored; kept so call sites need no change.) */
export async function onboard(
  b: ReturnType<typeof browser>,
  _google: unknown,
  o: { sub?: string; email?: string; walletIndex: number; side: "supplier" | "buyer" },
) {
  const s = await signIn(b, o.walletIndex);
  if (s.status !== 200) throw new Error(`sign-in failed: ${s.text}`);
  const side = await b.put("/api/me/side", { side: o.side });
  if (side.status !== 200) throw new Error(`side failed: ${side.text}`);
  return side.json.data;
}

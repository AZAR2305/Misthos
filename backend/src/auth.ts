import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { recoverMessageAddress, type Address, type Hex, type PublicClient } from "viem";
import type { Db } from "./db";

/** Anything the caller did wrong or any identity check that failed. `code` is stable for the UI; `status` is the HTTP status. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ---------------------------------------------------------------------------------------------------- Google sign-in

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  /** The single-use nonce the page asked Google to embed. The caller must consume it (see consumeGoogleNonce). */
  nonce: string | null;
}
export type GoogleVerifier = (credential: string) => Promise<GoogleProfile>;

/**
 * Verifies a Google ID token (the JWT the "Sign in with Google" button returns) on the server: signature against Google's
 * published keys, issuer, audience (our client id), expiry, and a verified email. The browser's word is never trusted.
 * `keys` exists so tests can supply a local signing key; production uses Google's JWKS URL.
 */
export function createGoogleVerifier(o: { clientId: string; issuers: string[]; jwksUrl: string; keys?: JWTVerifyGetKey }): GoogleVerifier {
  const keys = o.keys ?? createRemoteJWKSet(new URL(o.jwksUrl));
  return async (credential) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(credential, keys, { issuer: o.issuers, audience: o.clientId, algorithms: ["RS256"] }));
    } catch (e) {
      throw new AuthError(`Google sign-in could not be verified: ${e instanceof Error ? e.message : "invalid token"}`, "BAD_GOOGLE_TOKEN");
    }
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") throw new AuthError("The Google token has no email.", "BAD_GOOGLE_TOKEN");
    if (payload.email_verified !== true) throw new AuthError("Your Google email is not verified.", "EMAIL_NOT_VERIFIED", 403);
    return { sub: payload.sub, email: payload.email.toLowerCase(), name: typeof payload.name === "string" ? payload.name : null, nonce: typeof payload.nonce === "string" ? payload.nonce : null };
  };
}

/**
 * Sign-in nonces. The page asks for one, hands it to Google, and Google puts it inside the signed ID token. The server
 * accepts a token only if it carries a nonce it issued, once. So a token captured from a log, a proxy or a screenshot
 * is useless: it cannot be replayed, even within its one-hour life.
 */
export async function issueGoogleNonce(db: Db, now = new Date()): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  await db.query("insert into google_nonces (nonce, expires_at) values ($1, $2)", [nonce, expiresAt.toISOString()]);
  return { nonce, expiresAt };
}

export async function consumeGoogleNonce(db: Db, nonce: string | null, now = new Date()): Promise<void> {
  const r = nonce
    ? await db.query("update google_nonces set used_at = $2 where nonce = $1 and used_at is null and expires_at > $2 returning nonce", [nonce, now.toISOString()])
    : [];
  if (r.length === 0) throw new AuthError("This sign-in could not be confirmed (it is missing, expired or was already used). Try again.", "BAD_NONCE");
}

// ---------------------------------------------------------------------------------------------------- accounts

export type Side = "supplier" | "buyer";

export interface Account {
  id: string;
  email: string;
  name: string | null;
  side: Side | null;
  orgId: string | null;
  address: Address | null;
  addressBoundAt: Date | null;
}

interface AccountRow {
  id: string;
  email: string;
  display_name: string | null;
  side: Side | null;
  org_id: string | null;
  address: string | null;
  address_bound_at: Date | null;
}
const ACCOUNT_COLS = "a.id, a.email, a.display_name, a.side::text as side, a.org_id, a.address, a.address_bound_at";
const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  email: r.email,
  name: r.display_name,
  side: r.side,
  orgId: r.org_id,
  address: (r.address as Address | null) ?? null,
  addressBoundAt: r.address_bound_at ? new Date(r.address_bound_at) : null,
});

export async function upsertGoogleAccount(db: Db, p: GoogleProfile): Promise<Account> {
  const r = await db.query<AccountRow>(
    `insert into accounts as a (google_sub, email, email_verified, display_name) values ($1, $2, true, $3)
     on conflict (google_sub) do update set email = excluded.email, display_name = coalesce(excluded.display_name, a.display_name)
     returning ${ACCOUNT_COLS}`,
    [p.sub, p.email, p.name],
  );
  return toAccount(r[0]!);
}

/** Where the account is in the onboarding: signed in, wallet linked, side chosen. */
export const stepOf = (a: Account): "wallet" | "side" | "ready" => (!a.address ? "wallet" : !a.side ? "side" : "ready");

// ---------------------------------------------------------------------------------------------------- sessions

export const COOKIE = "misthos_session";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, accountId: string, ttlDays: number, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
  await db.query("insert into sessions (token_hash, account_id, expires_at) values ($1, $2, $3)", [hash(token), accountId, expiresAt.toISOString()]);
  return { token, expiresAt };
}

export async function accountFromToken(db: Db, token: string | undefined, now = new Date()): Promise<Account | null> {
  if (!token) return null;
  const r = await db.query<AccountRow>(
    `select ${ACCOUNT_COLS} from sessions s join accounts a on a.id = s.account_id where s.token_hash = $1 and s.expires_at > $2`,
    [hash(token), now.toISOString()],
  );
  return r[0] ? toAccount(r[0]) : null;
}

export async function destroySession(db: Db, token: string | undefined) {
  if (token) await db.query("delete from sessions where token_hash = $1", [hash(token)]);
}

export async function accountById(db: Db, id: string): Promise<Account> {
  const r = await db.query<AccountRow>(`select ${ACCOUNT_COLS} from accounts a where a.id = $1`, [id]);
  return toAccount(r[0]!);
}

// ---------------------------------------------------------------------------------------------------- wallet link

export const challengeMessage = (a: { email: string; address: string; chainId: number; site: string; nonce: string; issuedAt: Date; expiresAt: Date }) =>
  [
    "Misthos wants you to link this wallet to your Google account.",
    "",
    `Account: ${a.email}`,
    `Wallet: ${a.address}`,
    `Site: ${a.site}`,
    `Network: ${a.chainId}`,
    `Nonce: ${a.nonce}`,
    `Issued: ${a.issuedAt.toISOString()}`,
    `Expires: ${a.expiresAt.toISOString()}`,
    "",
    "Signing this message sends no transaction and costs nothing.",
  ].join("\n");

export async function createChallenge(db: Db, account: Account, address: Address, chainId: number, site: string, now = new Date()) {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  const lower = address.toLowerCase();
  const message = challengeMessage({ email: account.email, address: lower, chainId, site, nonce, issuedAt: now, expiresAt });
  await db.query("insert into auth_challenges (nonce, account_id, address, message, expires_at) values ($1, $2, $3, $4, $5)", [
    nonce,
    account.id,
    lower,
    message,
    expiresAt.toISOString(),
  ]);
  return { nonce, message, expiresAt };
}

/** A plain wallet signs with its key (recovered locally); a smart-contract wallet is asked on-chain (ERC-1271) when a client exists. */
export async function verifyWalletMessage(o: { client?: PublicClient; address: Address; message: string; signature: Hex }): Promise<boolean> {
  try {
    if ((await recoverMessageAddress({ message: o.message, signature: o.signature })).toLowerCase() === o.address.toLowerCase()) return true;
  } catch {
    /* not a 65-byte ECDSA signature: may be a contract wallet */
  }
  if (!o.client) return false;
  try {
    return await o.client.verifyMessage({ address: o.address, message: o.message, signature: o.signature });
  } catch {
    return false;
  }
}

export async function bindWallet(
  db: Db,
  account: Account,
  a: { address: Address; nonce: string; signature: Hex },
  verify: (message: string, signature: Hex, address: Address) => Promise<boolean>,
  now = new Date(),
): Promise<Account> {
  const address = a.address.toLowerCase() as Address;
  const rows = await db.query<{ message: string }>(
    "select message from auth_challenges where nonce = $1 and account_id = $2 and address = $3 and used_at is null and expires_at > $4",
    [a.nonce, account.id, address, now.toISOString()],
  );
  if (!rows[0]) throw new AuthError("That wallet request expired or was already used. Start again.", "BAD_CHALLENGE", 400);
  if (!(await verify(rows[0].message, a.signature, address))) throw new AuthError("The signature does not match that wallet.", "BAD_SIGNATURE", 400);
  try {
    await db.tx(async (t) => {
      await t.query("update auth_challenges set used_at = $2 where nonce = $1", [a.nonce, now.toISOString()]);
      await t.query("update accounts set address = $2, address_bound_at = $3 where id = $1", [account.id, address, now.toISOString()]);
    });
  } catch (e) {
    if (/unique|duplicate/i.test(e instanceof Error ? e.message : "")) throw new AuthError("That wallet is already linked to another account.", "ADDRESS_TAKEN", 409);
    throw e;
  }
  return accountById(db, account.id);
}

/** Choosing a side creates the account's organisation. Changing it later needs an explicit confirm. */
export async function chooseSide(db: Db, account: Account, side: Side, confirm: boolean): Promise<Account> {
  if (!account.address) throw new AuthError("Link your wallet before choosing a side.", "WALLET_REQUIRED", 409);
  if (account.side === side) return account;
  if (account.side && !confirm) throw new AuthError(`You are set up as a ${account.side}. Send confirm: true to switch to ${side}.`, "CONFIRM_REQUIRED", 409);
  await db.tx(async (t) => {
    if (account.orgId) {
      await t.query("update organizations set role = $2 where id = $1", [account.orgId, side]);
      await t.query("update accounts set side = $2 where id = $1", [account.id, side]);
    } else {
      const org = await t.query<{ id: string }>("insert into organizations (name, role) values ($1, $2) returning id", [account.name ?? account.email, side]);
      await t.query("update accounts set org_id = $2, side = $3 where id = $1", [account.id, org[0]!.id, side]);
    }
  });
  return accountById(db, account.id);
}

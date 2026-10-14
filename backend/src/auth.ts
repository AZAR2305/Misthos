import { createHash, randomBytes } from "node:crypto";
import { getAddress, recoverMessageAddress, type Address, type Hex, type PublicClient } from "viem";
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from "viem/siwe";
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

// ---------------------------------------------------------------------------------------------------- accounts

export type Side = "supplier" | "buyer";

export interface Account {
  id: string;
  name: string | null;
  side: Side | null;
  orgId: string | null;
  address: Address | null;
  addressBoundAt: Date | null;
}

interface AccountRow {
  id: string;
  display_name: string | null;
  side: Side | null;
  org_id: string | null;
  address: string | null;
  address_bound_at: Date | null;
}
const ACCOUNT_COLS = "a.id, a.display_name, a.side::text as side, a.org_id, a.address, a.address_bound_at";
const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.display_name,
  side: r.side,
  orgId: r.org_id,
  address: (r.address as Address | null) ?? null,
  addressBoundAt: r.address_bound_at ? new Date(r.address_bound_at) : null,
});

/** Where the account is in the onboarding: signed in with a wallet, side chosen. */
export const stepOf = (a: Account): "side" | "ready" => (!a.side ? "side" : "ready");

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

// ---------------------------------------------------------------------------------------------------- wallet sign-in

/**
 * The sign-in message is EIP-4361 (Sign-In with Ethereum), built and checked with viem's own SIWE helpers: the domain that asked, the wallet,
 * the chain id, a server-issued single-use nonce, the time it was issued and when it expires.
 */
export const challengeMessage = (a: { address: string; chainId: number; site: string; nonce: string; issuedAt: Date; expiresAt: Date }) =>
  createSiweMessage({
    domain: new URL(a.site).host,
    address: getAddress(a.address),
    statement: "Sign in to Misthos with your wallet. This sends no transaction and costs nothing. No email or personal detail is collected.",
    uri: new URL(a.site).origin,
    version: "1",
    chainId: a.chainId,
    nonce: a.nonce,
    issuedAt: a.issuedAt,
    expirationTime: a.expiresAt,
  });

/** A one-time message for this address and this site. The account does not exist yet; signing it creates it. */
export async function createChallenge(db: Db, address: Address, chainId: number, site: string, now = new Date()) {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  const lower = address.toLowerCase();
  const message = challengeMessage({ address: lower, chainId, site, nonce, issuedAt: now, expiresAt });
  await db.query("insert into auth_challenges (nonce, address, message, expires_at) values ($1, $2, $3, $4)", [nonce, lower, message, expiresAt.toISOString()]);
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

/**
 * Signing in: the wallet proves it controls the address by signing the one-time message. The challenge is spent once, the
 * account is found (or created) by address, and the caller starts a session. The address is the whole identity.
 */
export async function signInWithWallet(
  db: Db,
  a: { address: Address; nonce: string; signature: Hex },
  verify: (message: string, signature: Hex, address: Address) => Promise<boolean>,
  now = new Date(),
): Promise<Account> {
  const address = a.address.toLowerCase() as Address;
  const rows = await db.query<{ message: string }>(
    "select message from auth_challenges where nonce = $1 and address = $2 and used_at is null and expires_at > $3",
    [a.nonce, address, now.toISOString()],
  );
  if (!rows[0]) throw new AuthError("That sign-in request expired or was already used. Start again.", "BAD_CHALLENGE", 400);
  // The stored message must still be a valid, unexpired SIWE message for this very address and nonce before its signature is even looked at.
  const siwe = parseSiweMessage(rows[0].message);
  if (!validateSiweMessage({ message: siwe, address: getAddress(address), nonce: a.nonce, time: now })) throw new AuthError("That sign-in request expired or does not match. Start again.", "BAD_CHALLENGE", 400);
  if (!(await verify(rows[0].message, a.signature, address))) throw new AuthError("The signature does not match that wallet.", "BAD_SIGNATURE", 400);
  const id = await db.tx(async (t) => {
    const spent = await t.query("update auth_challenges set used_at = $2 where nonce = $1 and used_at is null returning nonce", [a.nonce, now.toISOString()]);
    if (spent.length === 0) throw new AuthError("That sign-in request was already used. Start again.", "BAD_CHALLENGE", 400);
    const r = await t.query<{ id: string }>(
      `insert into accounts (address, address_bound_at) values ($1, $2)
       on conflict (address) do update set address = excluded.address returning id`,
      [address, now.toISOString()],
    );
    return r[0]!.id;
  });
  return accountById(db, id);
}

/** Choosing a side creates the account's organisation. Changing it later needs an explicit confirm. */
export async function chooseSide(db: Db, account: Account, side: Side, confirm: boolean): Promise<Account> {
  if (account.side === side) return account;
  if (account.side && !confirm) throw new AuthError(`You are set up as a ${account.side}. Send confirm: true to switch to ${side}.`, "CONFIRM_REQUIRED", 409);
  await db.tx(async (t) => {
    if (account.orgId) {
      await t.query("update organizations set role = $2 where id = $1", [account.orgId, side]);
      await t.query("update accounts set side = $2 where id = $1", [account.id, side]);
    } else {
      const org = await t.query<{ id: string }>("insert into organizations (name, role) values ($1, $2) returning id", [account.name ?? account.address, side]);
      await t.query("update accounts set org_id = $2, side = $3 where id = $1", [account.id, org[0]!.id, side]);
    }
  });
  return accountById(db, account.id);
}

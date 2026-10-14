"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, apiEnabled } from "@/lib/api";
import { useRole, type Role } from "@/lib/storage";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CONFIG } from "@/lib/config";
import { useOnChainRole } from "@/lib/hooks";

/** What the server knows about the signed-in person. `step` is the next onboarding step; "ready" means a side is chosen. */
export interface Me {
  id: string;
  name: string | null;
  side: Role | null;
  address: string | null;
  step: "side" | "ready";
}

interface AccountValue {
  /** "off": no backend configured, the app runs on a wallet alone. "on": accounts are required to act. */
  mode: "off" | "on";
  status: "loading" | "ready" | "unreachable";
  me: Me | null;
  error: string | null;
  /** Proves control of the connected wallet by signing a one-time message. That creates (or finds) the account and starts the session. Resolves to an error message, or null. */
  signIn(): Promise<string | null>;
  signOut(): Promise<void>;
  chooseSide(side: Role, confirm?: boolean): Promise<string | null>;
}

const Ctx = createContext<AccountValue | null>(null);

export function useAccount(): AccountValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount must be used inside AccountProvider");
  return v;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const w = useWallet();
  const [state, setState] = useState<{ status: AccountValue["status"]; me: Me | null; error: string | null }>({ status: apiEnabled ? "loading" : "ready", me: null, error: null });

  const refresh = useCallback(async () => {
    if (!apiEnabled) return;
    const r = await api<Me | null>("/api/me");
    setState(r.ok ? { status: "ready", me: r.data, error: null } : { status: "unreachable", me: null, error: r.error.message });
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    setState({ status: "ready", me: null, error: null });
  }, []);

  const signIn = useCallback(async () => {
    if (w.status !== "connected" || !w.address || !w.walletClient) return "Connect your wallet first.";
    const ch = await api<{ nonce: string; message: string }>("/api/auth/wallet/challenge", { method: "POST", body: { address: w.address } });
    if (!ch.ok) return ch.error.message;
    let signature: `0x${string}`;
    try {
      signature = await w.walletClient.signMessage({ account: w.address, message: ch.data.message });
    } catch (e) {
      return (e as { code?: number }).code === 4001 ? "You closed the signature request. Nothing was sent; try again when you are ready." : "The wallet could not sign the message.";
    }
    const r = await api<Me>("/api/auth/wallet/signin", { method: "POST", body: { address: w.address, nonce: ch.data.nonce, signature } });
    if (!r.ok) return r.error.message;
    setState({ status: "ready", me: r.data, error: null });
    return null;
  }, [w.status, w.address, w.walletClient]);

  const chooseSide = useCallback(async (side: Role, confirm = false) => {
    const r = await api<Me>("/api/me/side", { method: "PUT", body: { side, confirm } });
    if (!r.ok) return r.error.message;
    setState({ status: "ready", me: r.data, error: null });
    return null;
  }, []);

  const value = useMemo<AccountValue>(
    () => ({ mode: apiEnabled ? "on" : "off", ...state, signIn, signOut, chooseSide }),
    [state, signIn, signOut, chooseSide],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * With accounts on, money moves only from the wallet the account was created with. Returns a sentence saying why not, or null when the
 * connected wallet may sign. Without accounts any connected wallet may sign (the app then runs on a wallet alone).
 */
export function useSignerCheck(): () => string | null {
  const acct = useAccount();
  const w = useWallet();
  return useCallback(() => {
    if (acct.mode === "off") return null;
    if (!acct.me) return "Sign in with your wallet first.";
    if (!acct.me.address) return "Sign in with your wallet first.";
    if (w.address && w.address !== acct.me.address) return `This wallet (${shortAddr(w.address)}) is not the one you signed in with (${shortAddr(acct.me.address)}). Switch to that wallet in your wallet app, or sign out and sign in again.`;
    return null;
  }, [acct, w.address]);
}

/**
 * The side the person acts as. With a role registry configured it is the wallet's fixed on-chain role and cannot be set from here at all: the only way to
 * get one is to register on Arc (see RoleChoice). Without a registry: with accounts it comes from the server, and without a backend it is the per-wallet
 * choice kept on this device (the old behaviour).
 */
export function useSide(): { side: Role | null; ready: boolean; set(next: Role): void; fixed: boolean; error: boolean } {
  const acct = useAccount();
  const w = useWallet();
  const onchain = useOnChainRole(w.address);
  const [local, setLocal, localReady] = useRole(w.address);
  const fixed = !!CONFIG.roleRegistry;
  const set = useCallback(
    (next: Role) => {
      if (fixed) return; // a role is not a setting
      if (acct.mode === "off") setLocal(next);
      else void acct.chooseSide(next, true);
    },
    [acct, setLocal, fixed],
  );
  if (fixed && acct.mode === "off") return { side: onchain.role, ready: onchain.status === "ready" || onchain.status === "error", set, fixed, error: onchain.status === "error" };
  if (acct.mode === "off") return { side: local, ready: localReady, set, fixed, error: false };
  return { side: acct.me?.side ?? null, ready: acct.status !== "loading", set, fixed, error: false };
}

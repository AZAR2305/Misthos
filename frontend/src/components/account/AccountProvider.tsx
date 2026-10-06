"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, apiEnabled } from "@/lib/api";
import { useRole, type Role } from "@/lib/storage";
import { useWallet } from "@/components/wallet/WalletProvider";

/** What the server knows about the signed-in person. `step` is the next onboarding step; "ready" means a side is chosen. */
export interface Me {
  id: string;
  email: string;
  name: string | null;
  side: Role | null;
  address: string | null;
  step: "wallet" | "side" | "ready";
}

interface AccountValue {
  /** "off": no backend configured, the app runs on a wallet alone. "on": accounts are required to act. */
  mode: "off" | "on";
  status: "loading" | "ready" | "unreachable";
  me: Me | null;
  error: string | null;
  signIn(credential: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** Proves control of the connected wallet by signing a one-time message, then links it. Resolves to an error message, or null. */
  linkWallet(): Promise<string | null>;
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

  const signIn = useCallback(async (credential: string) => {
    const r = await api<Me>("/api/auth/google", { method: "POST", body: { credential } });
    if (!r.ok) return r.error.message;
    setState({ status: "ready", me: r.data, error: null });
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    setState({ status: "ready", me: null, error: null });
  }, []);

  const linkWallet = useCallback(async () => {
    if (w.status !== "connected" || !w.address || !w.walletClient) return "Connect your wallet first.";
    const ch = await api<{ nonce: string; message: string }>("/api/auth/wallet/challenge", { method: "POST", body: { address: w.address } });
    if (!ch.ok) return ch.error.message;
    let signature: `0x${string}`;
    try {
      signature = await w.walletClient.signMessage({ account: w.address, message: ch.data.message });
    } catch (e) {
      return (e as { code?: number }).code === 4001 ? "You closed the signature request. Nothing was sent; try again when you are ready." : "The wallet could not sign the message.";
    }
    const r = await api<Me>("/api/auth/wallet/bind", { method: "POST", body: { address: w.address, nonce: ch.data.nonce, signature } });
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
    () => ({ mode: apiEnabled ? "on" : "off", ...state, signIn, signOut, linkWallet, chooseSide }),
    [state, signIn, signOut, linkWallet, chooseSide],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The side the person acts as. With accounts it comes from the server (and switching asks the server, with confirm);
 * without a backend it is the per-wallet choice kept on this device.
 */
export function useSide(): { side: Role | null; ready: boolean; set(next: Role): void } {
  const acct = useAccount();
  const w = useWallet();
  const [local, setLocal, localReady] = useRole(w.address);
  const set = useCallback(
    (next: Role) => {
      if (acct.mode === "off") setLocal(next);
      else void acct.chooseSide(next, true);
    },
    [acct, setLocal],
  );
  if (acct.mode === "off") return { side: local, ready: localReady, set };
  return { side: acct.me?.side ?? null, ready: acct.status !== "loading", set };
}

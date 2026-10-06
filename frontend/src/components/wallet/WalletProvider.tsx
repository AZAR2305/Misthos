"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, toHex, type WalletClient } from "viem";
import { appChain } from "@/lib/chain/client";
import { CONFIG } from "@/lib/config";
import { rememberConnected, wasConnected } from "@/lib/storage";

type Address = `0x${string}`;

/** The EIP-1193 surface we use. Any injected browser wallet (MetaMask, Rabby, Coinbase Wallet, ...) provides it. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

export interface DiscoveredWallet {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193;
}

interface State {
  status: "idle" | "connecting" | "connected";
  address?: Address;
  chainId?: number;
  walletName?: string;
  error?: string;
}

interface WalletContextValue extends State {
  wallets: DiscoveredWallet[];
  /** True when connected to the network this deployment uses. */
  onRightNetwork: boolean;
  walletClient: WalletClient | null;
  modalOpen: boolean;
  openModal(): void;
  closeModal(): void;
  connect(wallet: DiscoveredWallet): Promise<void>;
  disconnect(): void;
  switchNetwork(): Promise<void>;
}

const Ctx = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}

const CHAIN_PARAMS = {
  chainId: toHex(CONFIG.chainId),
  chainName: CONFIG.networkName,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: [CONFIG.rpcUrl],
  blockExplorerUrls: [CONFIG.explorer],
};

const asAddress = (v: unknown): Address | undefined => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v.toLowerCase() as Address) : undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [state, setState] = useState<State>({ status: "idle" });
  const [modalOpen, setModalOpen] = useState(false);
  const active = useRef<DiscoveredWallet | null>(null);

  // Discover injected wallets (EIP-6963), with window.ethereum as the fallback for older wallets.
  useEffect(() => {
    const found = new Map<string, DiscoveredWallet>();
    const add = (w: DiscoveredWallet) => {
      found.set(w.id, w);
      setWallets([...found.values()]);
    };
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<{ info: { uuid: string; name: string; icon: string }; provider: Eip1193 }>).detail;
      if (d?.info && d.provider) add({ id: d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    const t = window.setTimeout(() => {
      if (legacy && found.size === 0) add({ id: "injected", name: "Browser wallet", provider: legacy });
    }, 250);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.clearTimeout(t);
    };
  }, []);

  const bind = useCallback((w: DiscoveredWallet, address: Address, chainId: number) => {
    active.current = w;
    setState({ status: "connected", address, chainId, walletName: w.name });
  }, []);

  // Keep in sync when the user switches account or network inside the wallet.
  useEffect(() => {
    const w = active.current;
    if (state.status !== "connected" || !w?.provider.on) return;
    const onAccounts = ((accounts: string[]) => {
      const next = asAddress(accounts?.[0]);
      if (!next) {
        active.current = null;
        rememberConnected(false);
        setState({ status: "idle" });
      } else setState((s) => ({ ...s, address: next }));
    }) as (...a: never[]) => void;
    const onChain = ((id: string) => setState((s) => ({ ...s, chainId: Number(BigInt(id)) }))) as (...a: never[]) => void;
    w.provider.on("accountsChanged", onAccounts);
    w.provider.on("chainChanged", onChain);
    return () => {
      w.provider.removeListener?.("accountsChanged", onAccounts);
      w.provider.removeListener?.("chainChanged", onChain);
    };
  }, [state.status]);

  const connect = useCallback(
    async (w: DiscoveredWallet) => {
      setState({ status: "connecting" });
      try {
        const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
        const address = asAddress(accounts[0]);
        if (!address) throw new Error("The wallet did not share an account.");
        const chainId = Number(BigInt((await w.provider.request({ method: "eth_chainId" })) as string));
        bind(w, address, chainId);
        rememberConnected(true);
        setModalOpen(false);
      } catch (e) {
        const err = e as { code?: number; message?: string };
        setState({
          status: "idle",
          error: err.code === 4001 ? "You closed the wallet prompt. Connect again when you are ready." : (err.message ?? "The wallet could not connect."),
        });
      }
    },
    [bind],
  );

  // Silent reconnect: if this browser connected before and the wallet still allows it, no prompt is shown.
  useEffect(() => {
    if (state.status !== "idle" || wallets.length === 0 || !wasConnected()) return;
    const w = wallets[0]!;
    (async () => {
      try {
        const accounts = (await w.provider.request({ method: "eth_accounts" })) as string[];
        const address = asAddress(accounts[0]);
        if (address) {
          const chainId = Number(BigInt((await w.provider.request({ method: "eth_chainId" })) as string));
          bind(w, address, chainId);
        }
      } catch {
        /* wallet locked or unavailable: stay disconnected */
      }
    })();
  }, [wallets, state.status, bind]);

  const disconnect = useCallback(() => {
    active.current = null;
    rememberConnected(false);
    setState({ status: "idle" });
  }, []);

  const switchNetwork = useCallback(async () => {
    const w = active.current;
    if (!w) return;
    try {
      await w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_PARAMS.chainId }] });
    } catch (e) {
      const err = e as { code?: number };
      if (err.code === 4902 || err.code === -32603) {
        await w.provider.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
      } else if (err.code !== 4001) throw e;
    }
  }, []);

  const walletClient = useMemo(
    () =>
      state.status === "connected" && state.address && active.current
        ? createWalletClient({ account: state.address, chain: appChain, transport: custom(active.current.provider) })
        : null,
    [state.status, state.address],
  );

  const value: WalletContextValue = {
    ...state,
    wallets,
    onRightNetwork: state.chainId === CONFIG.chainId,
    walletClient,
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    connect,
    disconnect,
    switchNetwork,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

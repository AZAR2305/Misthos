"use client";

import { useLayoutEffect, type ReactNode } from "react";
import { initTheme } from "@/lib/themes";
import { ToastProvider } from "@/components/ui/toast";
import { ConnectModal } from "@/components/wallet/ConnectButton";
import { WalletProvider } from "@/components/wallet/WalletProvider";

/** Wallet, toasts and the single Connect wallet dialog, shared by the landing page and the app. */
export function Providers({ children }: { children: ReactNode }) {
  // Apply the saved or requested theme before the first paint of the client tree.
  useLayoutEffect(() => initTheme(), []);
  return (
    <ToastProvider>
      <WalletProvider>
        {children}
        <ConnectModal />
      </WalletProvider>
    </ToastProvider>
  );
}

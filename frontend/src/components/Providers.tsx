"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { ConnectModal } from "@/components/wallet/ConnectButton";
import { WalletProvider } from "@/components/wallet/WalletProvider";

/** Wallet, toasts and the single Connect wallet dialog, shared by the landing page and the app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <WalletProvider>
        {children}
        <ConnectModal />
      </WalletProvider>
    </ToastProvider>
  );
}

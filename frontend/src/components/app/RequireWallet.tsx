"use client";

import type { ReactNode } from "react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { InlineGate } from "./Gate";

/** Pages that act for a person need a connected wallet. Reading public data never does. */
export function RequireWallet({ why, children }: { why: string; children: (address: `0x${string}`) => ReactNode }) {
  const w = useWallet();
  if (w.status !== "connected" || !w.address) return <InlineGate why={why} />;
  return <>{children(w.address)}</>;
}

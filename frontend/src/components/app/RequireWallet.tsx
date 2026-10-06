"use client";

import type { ReactNode } from "react";
import { Empty } from "@/components/ui/kit";
import { useWallet } from "@/components/wallet/WalletProvider";

/** Pages that act for a person need a connected wallet. Reading public data never does. */
export function RequireWallet({ why, children }: { why: string; children: (address: `0x${string}`) => ReactNode }) {
  const w = useWallet();
  if (w.status !== "connected" || !w.address) {
    return (
      <Empty
        title="Connect your wallet to continue"
        body={why}
        action={
          <button type="button" className="btn btn-primary" onClick={w.openModal}>
            Connect wallet
          </button>
        }
      />
    );
  }
  return <>{children(w.address)}</>;
}

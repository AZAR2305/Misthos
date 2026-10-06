"use client";

import { useCallback, useState } from "react";
import type { Hex, WalletClient } from "viem";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/components/wallet/WalletProvider";
import { publicClient } from "./chain/client";
import { agentBus } from "./agent-bus";
import { CONFIG } from "./config";

const REASONS: Record<string, string> = {
  NotApproved: "This invoice is not approved, or it is already settled or disputed.",
  NotBuyer: "Only the buyer named on the invoice can do that. Switch to the buyer's wallet.",
  WrongStatus: "The invoice is not in a state where that is allowed.",
  OfferExpired: "That offer has expired. Ask the supplier for a new one.",
  PastDue: "The invoice is already due, so there is nothing to pay early. Pay it on the due date instead.",
  BadSignature: "The signature does not match the supplier's wallet.",
  RateTooHigh: "The rate is above what the supplier signed or above the 50% ceiling.",
  NonceUsed: "That offer was already used. Ask the supplier for a new one.",
  OfferMismatch: "The offer was signed for a different invoice.",
  AlreadyRegistered: "This invoice is already registered.",
  TokenNotAllowed: "That token is not allowed. Invoices settle in USDC.",
  DailyCapExceeded: "That payment would go over your daily cap. Raise it on the policy page or wait until tomorrow.",
  PerInvoiceCapExceeded: "That payment is above your per-invoice cap. Raise it on the policy page.",
  DiscountTooLarge: "The discount would be as large as the invoice, so the contract refused it.",
  BadParams: "Some details are not valid: check the amount, the due date and that buyer and supplier differ.",
  ERC20InsufficientAllowance: "The contract is not allowed to move enough of your USDC yet. Approve it first.",
  ERC20InsufficientBalance: "Your wallet does not hold enough USDC for this payment.",
};

/** Turn a wallet or contract failure into one sentence that says what failed and what to do. */
export function friendlyError(e: unknown): string {
  const err = e as {
    code?: number;
    shortMessage?: string;
    message?: string;
    walk?: (fn: (x: unknown) => boolean) => unknown;
  };
  if (err?.code === 4001 || /user (rejected|denied)/i.test(err?.message ?? "")) return "You cancelled it in your wallet. Nothing was sent.";
  const reverted = err?.walk?.((x) => (x as { name?: string }).name === "ContractFunctionRevertedError") as { data?: { errorName?: string } } | undefined;
  const name = reverted?.data?.errorName;
  if (name && REASONS[name]) return REASONS[name]!;
  const text = `${err?.shortMessage ?? ""} ${err?.message ?? ""}`;
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(text)) {
    return `Your wallet has no USDC to pay the network fee. Get some at ${CONFIG.faucetUrl.replace("https://", "")}.`;
  }
  if (/Failed to fetch|network|timeout|ECONN/i.test(text)) return "The network could not be reached. Check your connection and try again.";
  return (err?.shortMessage ?? err?.message ?? "Something went wrong. Nothing was sent.").split("\n")[0]!;
}

export interface TxLabels {
  /** Present tense, shown on the button while it runs, for example "Signing invoice". */
  pending: string;
  /** Past tense, shown in the success toast, for example "Invoice registered". */
  done: string;
}

/**
 * Send one transaction from the connected wallet and wait for it. It checks the wallet and the network first, then
 * toasts the result with an explorer link. Returns the hash on success and undefined otherwise.
 */
export function useTx() {
  const wallet = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (labels: TxLabels, send: (wc: WalletClient, account: `0x${string}`) => Promise<Hex>): Promise<Hex | undefined> => {
      if (!wallet.walletClient || !wallet.address) {
        wallet.openModal();
        return undefined;
      }
      if (!wallet.onRightNetwork) {
        toast.push({ kind: "error", title: `Switch to ${CONFIG.networkName}`, body: "Your wallet is on a different network. Use the Switch network button in the top bar." });
        return undefined;
      }
      setBusy(labels.pending);
      agentBus.emit({ kind: "working", text: labels.pending });
      try {
        const hash = await send(wallet.walletClient, wallet.address);
        const receipt = await publicClient().waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction was included but reverted.");
        toast.push({ kind: "success", title: labels.done, tx: hash });
        return hash;
      } catch (e) {
        toast.push({ kind: "error", title: `${labels.pending.replace(/ing\b/, "e")} did not go through`, body: friendlyError(e) });
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [wallet, toast],
  );

  return { run, busy };
}

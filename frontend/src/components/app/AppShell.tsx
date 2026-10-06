"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArcGlyph } from "@/components/landing/Nav";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { ThemePicker } from "@/components/ThemePicker";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Money, Notice } from "@/components/ui/kit";
import { CONFIG } from "@/lib/config";
import { useUsdcBalance } from "@/lib/hooks";
import { useChainData } from "./ChainData";

interface NavItem {
  href: string;
  label: string;
  hint: string;
}

/** Grouped by what the person is doing, not by how the system is built. */
const GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Suppliers",
    items: [
      { href: "/supplier", label: "My invoices", hint: "Invoices you are owed" },
      { href: "/supplier/invoices/new", label: "New invoice", hint: "Create and sign one" },
    ],
  },
  {
    title: "Buyers",
    items: [
      { href: "/buyer", label: "Treasury and plan", hint: "Cash, offers, what to pay early" },
      { href: "/buyer/approvals", label: "Approvals", hint: "Invoices waiting for you" },
      { href: "/buyer/policy", label: "Policy and limits", hint: "Caps and guardrails" },
    ],
  },
  {
    title: "Everyone",
    items: [
      { href: "/invoices", label: "All invoices", hint: "Every invoice on this network" },
      { href: "/ledger", label: "Ledger", hint: "Journal and exports" },
      { href: "/stats", label: "Live stats", hint: "Public, from the chain" },
      { href: "/agents", label: "Agents", hint: "The supplier and buyer agents" },
      { href: "/kit", label: "Developer kit", hint: "Run it yourself" },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const w = useWallet();
  const chain = useChainData();
  const { balance } = useUsdcBalance(w.address);

  return (
    <div className="app" data-rail={open}>
      <aside className="rail" aria-label="Main">
        <Link href="/" className="rail-brand" aria-label="Misthos home">
          <ArcGlyph size={22} />
          <span>MISTHOS</span>
        </Link>
        <nav>
          <Link href="/app" className="rail-link" aria-current={path === "/app" ? "page" : undefined} onClick={() => setOpen(false)}>
            <span>Start here</span>
            <small>Pick your role</small>
          </Link>
          {GROUPS.map((g) => (
            <div key={g.title} className="rail-group">
              <p className="rail-title">{g.title}</p>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className="rail-link" aria-current={path === i.href ? "page" : undefined} onClick={() => setOpen(false)}>
                  <span>{i.label}</span>
                  <small>{i.hint}</small>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          {w.status === "connected" && w.address ? (
            <>
              <p className="muted tiny">Connected</p>
              <p className="mono">{`${w.address.slice(0, 6)}…${w.address.slice(-4)}`}</p>
              <p className="rail-bal">{balance === null ? <span className="muted">Reading balance…</span> : <Money minor={balance} accent />} <span className="muted tiny">USDC</span></p>
            </>
          ) : (
            <p className="muted tiny">No wallet connected. You can read everything; connect to sign or pay.</p>
          )}
          <a className="rail-ext" href={CONFIG.repoUrl} target="_blank" rel="noreferrer">
            Source on GitHub ↗
          </a>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <button type="button" className="burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span />
            <span />
          </button>
          <div className="topbar-status">
            <span className="net-badge">{`{${CONFIG.isTestnet ? "testnet" : "mainnet"}} ${CONFIG.networkName}`}</span>
            <span className="health" title={chain.rpcOk === false ? "The network RPC is not answering" : chain.rpcOk ? `RPC ok${chain.head ? `, block ${chain.head}` : ""}` : "Checking the RPC"}>
              <span className="dot" data-ok={chain.rpcOk === null ? "unknown" : String(chain.rpcOk)} aria-hidden="true" />
              {chain.rpcOk === false ? "Network unreachable" : chain.rpcOk ? "Network live" : "Connecting"}
            </span>
          </div>
          <ThemePicker />
          <ConnectButton />
        </div>

        <div className="banners">
          {w.status === "connected" && !w.onRightNetwork && (
            <Notice
              kind="warn"
              title={`Your wallet is on a different network`}
              action={
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void w.switchNetwork()}>
                  Switch to {CONFIG.networkName}
                </button>
              }
            >
              Pay and sign only work on {CONFIG.networkName}.
            </Notice>
          )}
          {chain.status === "unconfigured" && (
            <Notice kind="info" title="The InvoiceBook contract is not deployed on this network yet">
              You can explore every page, but there is nothing to read or sign until it is. The steps are in{" "}
              <a href={`${CONFIG.repoUrl}/blob/main/docs/SETUP.md`} target="_blank" rel="noreferrer">docs/SETUP.md</a>.
            </Notice>
          )}
          {chain.status === "error" && (
            <Notice kind="error" title="Could not read the chain" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => void chain.refresh()}>Try again</button>}>
              {chain.error}. Your data is safe; this is only the page failing to fetch it.
            </Notice>
          )}
        </div>

        <main className="page" id="content">
          {children}
        </main>
      </div>
    </div>
  );
}

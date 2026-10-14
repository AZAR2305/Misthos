"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArcGlyph } from "@/components/landing/Nav";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { ThemePicker } from "@/components/ThemePicker";
import { useWallet } from "@/components/wallet/WalletProvider";
import { Money, Notice, Skeleton } from "@/components/ui/kit";
import { CONFIG } from "@/lib/config";
import { useUsdcBalance } from "@/lib/hooks";
import { type Role } from "@/lib/storage";
import { agentBus } from "@/lib/agent-bus";
import { formatUsd } from "@/lib/core";
import { useAccount, useSide } from "@/components/account/AccountProvider";
import { Onboarding } from "./Onboarding";
import { AgentCompanion } from "./AgentCompanion";
import { useChainData } from "./ChainData";
import { ROLE_HOME } from "./RoleChoice";

interface Tab {
  href: string;
  label: string;
  /** Matches only this exact path, not the pages under it. */
  exact?: boolean;
}

const HOME: Tab = { href: "/app", label: "Overview", exact: true };
const PUBLIC: Tab[] = [
  { href: "/invoices", label: "All invoices" },
  { href: "/ledger", label: "Ledger" },
  { href: "/stats", label: "Live stats" },
  { href: "/shadow", label: "Shadow report" },
  { href: "/agents", label: "Agent log" },
  { href: "/docs", label: "Docs" },
];

const DOCS = PUBLIC[PUBLIC.length - 1]!;
const EXPLORE = PUBLIC.slice(0, -1);

/**
 * The side the person chose gets its own pages in the bar, then Docs; the other public pages sit under "More" so the bar
 * never has to squeeze. Without a side there is nothing private to show, so every public page stands on its own.
 */
function tabsFor(role: Role | null): { primary: Tab[]; more: Tab[] } {
  if (role === "supplier") return { primary: [HOME, { href: "/supplier", label: "My invoices", exact: true }, { href: "/supplier/invoices/new", label: "New invoice" }, { href: "/supplier/policy", label: "Credit limits" }, DOCS], more: EXPLORE };
  if (role === "buyer") return { primary: [HOME, { href: "/buyer", label: "Treasury", exact: true }, { href: "/buyer/approvals", label: "Approvals" }, { href: "/buyer/policy", label: "Policy" }, DOCS], more: EXPLORE };
  return { primary: [HOME, ...PUBLIC], more: [] };
}

const isActive = (t: Tab, path: string) => path === t.href || (!t.exact && path.startsWith(`${t.href}/`));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The public pages, in a menu, so the bar has room for the person's own pages and wallet. */
function MoreMenu({ items, path }: { items: Tab[]; path: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const active = items.some((t) => isActive(t, path));
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", on);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", on);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="tab-more" ref={box}>
      <button type="button" className="tab" aria-haspopup="menu" aria-expanded={open} aria-current={active ? "page" : undefined} onClick={() => setOpen((v) => !v)}>
        More <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="more-menu" role="menu">
          {items.map((t) => (
            <Link key={t.href} role="menuitem" href={t.href} aria-current={isActive(t, path) ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const CoinGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 4.2v7.6M6 6.4c.3-.7 1-1 2-1 1.2 0 2 .5 2 1.3 0 1.8-4 .9-4 2.9 0 .8.8 1.4 2 1.4 1 0 1.8-.3 2.1-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const w = useWallet();
  const chain = useChainData();
  const { balance } = useUsdcBalance(w.address);
  const acct = useAccount();
  const { side: role, set: setRole } = useSide();
  const [scrolled, setScrolled] = useState(false);
  const greeted = useRef<string | null>(null);
  useEffect(() => {
    if (!w.address || balance === null || greeted.current === w.address) return;
    greeted.current = w.address;
    agentBus.emit({ kind: "hello", text: `You hold ${formatUsd(balance)} USDC on ${CONFIG.networkName}.` });
  }, [w.address, balance]);
  const { primary, more } = tabsFor(role);
  const tabs = primary;

  // Being on a supplier or buyer page means acting as that side: keep the chosen side in step.
  useEffect(() => {
    if (acct.mode === "on" || w.status !== "connected") return;
    const side: Role | null = path.startsWith("/supplier") ? "supplier" : path.startsWith("/buyer") ? "buyer" : null;
    if (side && side !== role) setRole(side);
  }, [path, role, setRole, w.status, acct.mode]);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // The sliding underline under the active tab.
  const nav = useRef<HTMLElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!el) return setBar(null);
      setBar({ x: el.offsetLeft, w: el.offsetWidth });
      el.scrollIntoView({ block: "nearest", inline: "center" });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [path, role, tabs.length, more.length]);

  const pathSide: Role | null = path.startsWith("/supplier") ? "supplier" : path.startsWith("/buyer") ? "buyer" : null;
  const ready = acct.mode === "on" ? acct.status === "ready" && acct.me?.step === "ready" : w.status === "connected";
  const linked = acct.me?.address ?? null;
  const switchTo = (next: Role) => {
    setRole(next);
    router.push(ROLE_HOME[next]);
  };

  return (
    <div className="app">
      <header className="appbar" data-scrolled={scrolled}>
        <div className="appbar-row">
          <Link href="/" className="rail-brand" aria-label="Misthos home">
            <ArcGlyph size={22} />
            <span>MISTHOS</span>
          </Link>
          <div className="tabs-wrap">
            <nav className="tabs" aria-label="Main" ref={nav}>
              {tabs.map((t) => (
                <Link key={t.href} href={t.href} className="tab" aria-current={isActive(t, path) ? "page" : undefined}>
                  {t.label}
                </Link>
              ))}
              <span className="tab-bar" aria-hidden="true" style={bar ? { transform: `translateX(${bar.x}px)`, width: bar.w, opacity: 1 } : { opacity: 0 }} />
            </nav>
            <MoreMenu items={more} path={path} />
          </div>
          <div className="appbar-end">
            {w.status === "connected" && w.address && (
              <span className="bal-chip" title={`USDC held by ${short(w.address)} on ${CONFIG.networkName}`}>
                <CoinGlyph />
                {balance === null ? <span className="muted">reading…</span> : <Money minor={balance} count />}
                <span className="bal-unit">USDC</span>
              </span>
            )}
            {ready &&
              (role ? (
                <div className="role-switch" role="group" aria-label="Your side">
                  {(["supplier", "buyer"] as const).map((r) => (
                    <button key={r} type="button" data-role={r} aria-pressed={role === r} onClick={() => (role === r ? router.push(ROLE_HOME[r]) : switchTo(r))}>
                      {r === "supplier" ? "Supplier" : "Buyer"}
                    </button>
                  ))}
                </div>
              ) : (
                path !== "/app" && <Link href="/app" className="btn btn-ghost btn-sm">Choose your side</Link>
              ))}
            <ThemePicker />
            <ConnectButton />
          </div>
        </div>
      </header>

      <div className="banners">
        {acct.mode === "on" && linked && w.status === "connected" && w.address !== linked && (
          <Notice kind="warn" title="This is not the wallet linked to your account">
            You are signed in with the wallet <span className="mono">{linked.slice(0, 6)}…{linked.slice(-4)}</span>. Switch to it in your wallet before you sign or pay anything.
          </Notice>
        )}
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
        {chain.status === "error" && (
          <Notice kind="error" title="Could not read the chain" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => void chain.refresh()}>Try again</button>}>
            {(chain.error ?? "").replace(/\.+$/, "")}. Your data is safe; this is only the page failing to fetch it.
          </Notice>
        )}
      </div>

      <main className="page" id="content" key={path}>
        {acct.mode === "on" && pathSide && acct.status !== "ready" ? (
          <Skeleton rows={4} />
        ) : acct.mode === "on" && pathSide && acct.me?.step !== "ready" ? (
          <Onboarding />
        ) : acct.mode === "on" && pathSide && acct.me?.side !== pathSide ? (
          <section className="card welcome" data-role={pathSide}>
            <div>
              <p className="ptag">{pathSide === "supplier" ? "Supplier" : "Buyer"}</p>
              <h2>This page is for {pathSide}s</h2>
              <p className="muted">Your account is set up as a {acct.me?.side}. Switch sides to use this page; you can switch back at any time.</p>
            </div>
            <div className="actions-row">
              <button type="button" className="btn btn-primary" onClick={() => switchTo(pathSide)}>Switch to {pathSide}</button>
              <Link className="btn btn-ghost" href={ROLE_HOME[acct.me!.side!]}>Back to my dashboard</Link>
            </div>
          </section>
        ) : (
          children
        )}
      </main>

      <AgentCompanion />

      <footer className="appfoot">
        <span>
          {w.status === "connected" && w.address ? (
            <>
              <span className="mono">{short(w.address)}</span> · {balance === null ? "reading balance…" : <Money minor={balance} accent />} <span className="muted tiny">USDC</span>
            </>
          ) : (
            <span className="muted">No wallet connected. Everything public is readable.</span>
          )}
          {acct.me && (
            <>
              {" · "}
              <span title="Signed in with this wallet" className="mono">{acct.me.address ? `${acct.me.address.slice(0, 6)}…${acct.me.address.slice(-4)}` : "wallet"}</span>{" "}
              <button type="button" className="linklike" onClick={() => void acct.signOut()}>Sign out</button>
            </>
          )}
        </span>
        <span className="appfoot-links">
          <span className="net-foot" title={chain.rpcOk === false ? "The network RPC is not answering" : chain.rpcOk ? `RPC ok${chain.head ? `, block ${chain.head}` : ""}` : "Checking the RPC"}>
            <span className="dot" data-ok={chain.rpcOk === null ? "unknown" : String(chain.rpcOk)} aria-hidden="true" /> {CONFIG.networkName} · {chain.rpcOk === false ? "unreachable" : chain.rpcOk ? "live" : "connecting"}
          </span>
          <a href={CONFIG.repoUrl} target="_blank" rel="noreferrer">Source on GitHub ↗</a>
        </span>
      </footer>
    </div>
  );
}

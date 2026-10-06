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
import { useAccount, useSide } from "@/components/account/AccountProvider";
import { Onboarding } from "./Onboarding";
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
  { href: "/ledger", label: "Ledger" },
  { href: "/stats", label: "Live stats" },
  { href: "/agents", label: "Agents" },
];

/** What a person sees in the header depends on the side they chose; the public pages are always there. */
function tabsFor(role: Role | null): Tab[] {
  if (role === "supplier")
    return [HOME, { href: "/supplier", label: "My invoices", exact: true }, { href: "/supplier/invoices/new", label: "New invoice" }, { href: "/invoices", label: "All invoices" }, ...PUBLIC];
  if (role === "buyer")
    return [HOME, { href: "/buyer", label: "Treasury", exact: true }, { href: "/buyer/approvals", label: "Approvals" }, { href: "/buyer/policy", label: "Policy" }, { href: "/invoices", label: "All invoices" }, ...PUBLIC];
  return [HOME, { href: "/invoices", label: "Invoices" }, ...PUBLIC];
}

const isActive = (t: Tab, path: string) => path === t.href || (!t.exact && path.startsWith(`${t.href}/`));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const w = useWallet();
  const chain = useChainData();
  const { balance } = useUsdcBalance(w.address);
  const acct = useAccount();
  const { side: role, set: setRole } = useSide();
  const [scrolled, setScrolled] = useState(false);
  const tabs = tabsFor(role);

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
  }, [path, role, tabs.length]);

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
          <nav className="tabs" aria-label="Main" ref={nav}>
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} className="tab" aria-current={isActive(t, path) ? "page" : undefined}>
                {t.label}
              </Link>
            ))}
            <span className="tab-bar" aria-hidden="true" style={bar ? { transform: `translateX(${bar.x}px)`, width: bar.w, opacity: 1 } : { opacity: 0 }} />
          </nav>
          <div className="appbar-end">
            <span className="net-badge" title={chain.rpcOk === false ? "The network RPC is not answering" : chain.rpcOk ? `RPC ok${chain.head ? `, block ${chain.head}` : ""}` : "Checking the RPC"}>
              <span className="dot" data-ok={chain.rpcOk === null ? "unknown" : String(chain.rpcOk)} aria-hidden="true" />
              {CONFIG.networkName}
              <span className="net-live">{chain.rpcOk === false ? "unreachable" : chain.rpcOk ? "live" : "connecting"}</span>
            </span>
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

      <main className="page" id="content" key={path}>
        {acct.mode === "on" && pathSide && acct.status !== "ready" ? (
          <Skeleton rows={4} />
        ) : acct.mode === "on" && pathSide && acct.me?.step !== "ready" ? (
          <Onboarding />
        ) : acct.mode === "on" && pathSide && acct.me?.side !== pathSide ? (
          <section className="card welcome" data-role={pathSide}>
            <div>
              <p className="ptag">{"{" + pathSide + "}"}</p>
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
              <span title="Signed in with Google">{acct.me.email}</span>{" "}
              <button type="button" className="linklike" onClick={() => void acct.signOut()}>Sign out</button>
            </>
          )}
        </span>
        <span className="appfoot-links">
          <Link href="/kit">Developer kit</Link>
          <a href={CONFIG.repoUrl} target="_blank" rel="noreferrer">Source on GitHub ↗</a>
        </span>
      </footer>
    </div>
  );
}

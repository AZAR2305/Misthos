"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { addressUrl, txUrl } from "@/lib/config";
import { formatUsd } from "@/lib/core";
import type { InvoiceStatus } from "@/lib/chain/invoices";

/* ---------------------------------------------------------------- layout */

export function PageHeader({ title, lead, actions, help }: { title: string; lead: ReactNode; actions?: ReactNode; help?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <div>
          <h1>{title}</h1>
          <p className="lead">{lead}</p>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {help && (
        <details className="help">
          <summary>What is this page?</summary>
          <div className="help-body">{help}</div>
        </details>
      )}
    </header>
  );
}

export function Card({ title, aside, children, tone, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; tone?: "agent"; className?: string }) {
  return (
    <section className={`card ${tone === "agent" ? "card-agent" : ""} ${className}`}>
      {(title || aside) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${accent ? "is-money" : ""}`}>{value}</p>
      {hint && <p className="stat-hint">{hint}</p>}
    </div>
  );
}

/* ----------------------------------------------------------- small facts */

const STATUS: Record<InvoiceStatus | "draft", { label: string; icon: string; tone: string }> = {
  draft: { label: "Draft", icon: "○", tone: "muted" },
  registered: { label: "Registered", icon: "◔", tone: "outline" },
  approved: { label: "Approved", icon: "●", tone: "fill" },
  settled_early: { label: "Paid early", icon: "✓", tone: "ok" },
  settled_due: { label: "Paid on due date", icon: "✓", tone: "ok-muted" },
  disputed: { label: "Disputed", icon: "!", tone: "bad" },
};

/** Always icon plus word: colour never carries status alone. */
export function StatusChip({ status }: { status: InvoiceStatus | "draft" }) {
  const s = STATUS[status];
  return (
    <span className="chip" data-tone={s.tone}>
      <span aria-hidden="true">{s.icon}</span> {s.label}
    </span>
  );
}

/** Where a fact came from: {on-chain}, {agent}, {human}, {testnet}. Only on facts, never decoration. */
export function Tag({ children, tone }: { children: ReactNode; tone?: "agent" }) {
  return <span className={`ptag ${tone === "agent" ? "ptag-agent" : ""}`}>{`{${children}}`}</span>;
}

/** USDC amount from 6-decimal minor units. Accent only when it is the number the reader acts on. */
export function Money({ minor, accent, dp = 2 }: { minor: bigint; accent?: boolean; dp?: number }) {
  return <span className={`money ${accent ? "is-money" : ""}`}>{formatUsd(minor, dp)}</span>;
}

export function Apr({ bps }: { bps: bigint | number }) {
  return <span className="money">{(Number(bps) / 100).toFixed(1)}% APR</span>;
}

const mid = (s: string, a = 6, b = 4) => (s.length > a + b + 2 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`${label} ${mid(text)}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function TxLink({ hash }: { hash?: string }) {
  if (!hash) return <span className="muted">unavailable</span>;
  return (
    <span className="mono-link">
      <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="mono">
        {mid(hash, 8, 6)} ↗
      </a>
      <CopyButton text={hash} />
    </span>
  );
}

export function AddressChip({ address, you, label }: { address: string; you?: boolean; label?: string }) {
  return (
    <span className="mono-link">
      {label && <span className="muted">{label} </span>}
      <a href={addressUrl(address)} target="_blank" rel="noreferrer" className="mono">
        {mid(address)}
      </a>
      {you && <span className="you">you</span>}
      <CopyButton text={address} />
    </span>
  );
}

/* ------------------------------------------------------------- feedback */

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function Notice({ kind = "info", title, children, action }: { kind?: "info" | "warn" | "error" | "ok"; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="notice" data-kind={kind} role={kind === "error" ? "alert" : "status"}>
      <div>
        <p className="notice-title">{title}</p>
        {children && <div className="notice-body">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** A glossary term: underlined, with the plain-language meaning on hover and focus. */
export function Term({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <abbr className="term" title={tip} tabIndex={0}>
      {children}
    </abbr>
  );
}

/** Anything an agent said or decided. The only place the agent colour fills a surface. */
export function AgentNote({ who, children, evidence }: { who: string; children: ReactNode; evidence?: string[] }) {
  return (
    <div className="agent-note">
      <p className="agent-note-head">
        <Tag tone="agent">agent</Tag> <span>{who}</span>
      </p>
      <div className="agent-note-body">{children}</div>
      {evidence && evidence.length > 0 && <p className="agent-note-ev">Evidence: {evidence.join(", ")}</p>}
    </div>
  );
}

/** A true sequence, so the steps are numbered. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label="Invoice progress">
      {steps.map((s, i) => (
        <li key={s} data-state={i < current ? "done" : i === current ? "now" : "todo"} aria-current={i === current ? "step" : undefined}>
          <span className="step-dot">{i < current ? "✓" : i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------- forms */

export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: ReactNode; error?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" id={`${htmlFor}-err`}>
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A command or snippet the reader can copy. Every instruction on the kit page is meant to be pasted and run. */
export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="code-wrap">
      <span className="code" aria-label={label}>{children}</span>
      <CopyButton text={children} />
    </div>
  );
}

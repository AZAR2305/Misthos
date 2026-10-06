"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { txUrl } from "@/lib/config";

export interface ToastInput {
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
  /** Transaction hash: shown as an explorer link. */
  tx?: string;
}
interface Toast extends ToastInput {
  id: number;
}

const Ctx = createContext<{ push(t: ToastInput): void } | null>(null);

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside ToastProvider");
  return v;
}

/** Same verb in the button and the toast ("Sign invoice" -> "Invoice signed"); errors say what failed and the fix. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: ToastInput) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur.slice(-3), { ...t, id }]);
    window.setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), t.kind === "error" ? 12_000 : 7_000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-kind={t.kind} role={t.kind === "error" ? "alert" : "status"}>
            <p className="toast-title">{t.title}</p>
            {t.body && <p className="toast-body">{t.body}</p>}
            {t.tx && (
              <a className="toast-link mono" href={txUrl(t.tx)} target="_blank" rel="noreferrer">
                {t.tx.slice(0, 10)}…{t.tx.slice(-6)} on the explorer
              </a>
            )}
            <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

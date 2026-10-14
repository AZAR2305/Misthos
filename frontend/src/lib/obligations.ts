"use client";

import { useCallback, useEffect, useState } from "react";
import { CONFIG } from "./config";
import { parseAgentObligations } from "./obligations-parse";
import { useObligations, type StoredObligations } from "./storage";

type Item = StoredObligations[number];

export interface DeclaredObligations {
  /**
   * Where the list lives. "agent": in the encrypted store of your own buyer agent on your machine, never on the shared Misthos server.
   * "browser": no agent is connected, so it stays on this device and is sent to the agent only when you ask for a plan.
   */
  source: "agent" | "browser";
  items: StoredObligations;
  status: "loading" | "ready" | "unavailable";
  /** True once the owner has declared a calendar (even an empty one). An undeclared calendar makes the agent accept nothing. */
  declared: boolean;
  error?: string;
  add(o: Item): Promise<void>;
  remove(id: string): Promise<void>;
  /** Say "I have no upcoming payments" explicitly. */
  declareNone(): Promise<void>;
}

const call = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${CONFIG.buyerAgentUrl}${path}`, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000) });
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; data?: unknown; error?: { message?: string } };
  if (!r.ok || !body.ok) throw new Error(body.error?.message ?? `The agent answered ${r.status}.`);
  return body.data;
};

/**
 * The buyer's declared payments (payroll, bills). They are private, so they are kept by the buyer agent in an encrypted file on the
 * owner's own machine; this page talks to that agent directly. Nothing about them is sent to the shared Misthos server. When no agent is
 * connected they stay in this browser and go to the agent only with a plan request.
 */
export function useDeclaredObligations(): DeclaredObligations {
  const [local, setLocal] = useObligations();
  const viaAgent = !!CONFIG.buyerAgentUrl;
  const [rows, setRows] = useState<{ status: "loading" | "ready" | "unavailable"; items: StoredObligations; declared: boolean; error?: string }>({ status: "loading", items: [], declared: false });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!viaAgent) return;
    let live = true;
    call("/obligations")
      .then((data) => {
        if (!live) return;
        const parsed = parseAgentObligations(data);
        setRows(parsed ? { status: "ready", items: parsed.items, declared: parsed.declared } : { status: "unavailable", items: [], declared: false, error: "The agent's answer was not understood." });
      })
      .catch((e: Error) => live && setRows({ status: "unavailable", items: [], declared: false, error: `Your buyer agent could not be reached (${e.message}). Start it, or your payments cannot be read.` }));
    return () => {
      live = false;
    };
  }, [viaAgent, n]);

  const reload = () => setN((x) => x + 1);
  const fail = (e: unknown) => setRows((s) => ({ ...s, error: (e as Error).message }));

  const add = useCallback(
    async (o: Item) => {
      if (!viaAgent) return setLocal([...local, o]);
      try {
        await call("/obligations", { method: "POST", body: JSON.stringify({ label: o.label, amount: o.amount, dueSec: o.dueSec, kind: o.kind }) });
      } catch (e) {
        fail(e);
      }
      reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viaAgent, local],
  );
  const remove = useCallback(
    async (id: string) => {
      if (!viaAgent) return setLocal(local.filter((x) => x.id !== id));
      try {
        await call(`/obligations/${encodeURIComponent(id)}/remove`, { method: "POST", body: "{}" });
      } catch (e) {
        fail(e);
      }
      reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viaAgent, local],
  );
  const declareNone = useCallback(async () => {
    if (!viaAgent) return;
    try {
      await call("/obligations/declare-none", { method: "POST", body: "{}" });
    } catch (e) {
      fail(e);
    }
    reload();
  }, [viaAgent]);

  return viaAgent
    ? { source: "agent", items: rows.items, status: rows.status, declared: rows.declared, error: rows.error, add, remove, declareNone }
    : { source: "browser", items: local, status: "ready", declared: true, add, remove, declareNone };
}

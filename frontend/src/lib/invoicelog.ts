"use client";

import { useEffect, useState } from "react";
import { api, apiEnabled } from "./api";
import { CONFIG } from "./config";
import { fromAgentEntry, fromApiEntry, mergeEntries, type LogEntry } from "./trace";

/**
 * Every logged decision about one invoice. The public API's copy is verified (hash, chain and signature) and visible to anyone;
 * an agent running on this machine adds what it has not delivered yet. If neither answers, the state says so.
 */
export type InvoiceLogState = {
  status: "loading" | "ready";
  entries: LogEntry[];
  /** Why a source could not be read, for a quiet footnote. Never a reason to invent entries. */
  notes: string[];
  fromApi: boolean;
};

async function fetchAgent(url: string, invoiceId: string): Promise<LogEntry[] | undefined> {
  if (!url) return undefined;
  try {
    const r = await fetch(`${url}/decisions`, { signal: AbortSignal.timeout(2500) });
    const body = (await r.json()) as { ok: boolean; data?: { entries: unknown[] } };
    if (!r.ok || !body.ok || !body.data) return undefined;
    return body.data.entries.map(fromAgentEntry).filter((e): e is LogEntry => !!e && String(e.snapshot.invoiceId ?? "").toLowerCase() === invoiceId);
  } catch {
    return undefined;
  }
}

export function useInvoiceLog(invoiceId: string): InvoiceLogState {
  const id = invoiceId.toLowerCase();
  const [state, setState] = useState<InvoiceLogState>({ status: "loading", entries: [], notes: [], fromApi: false });
  useEffect(() => {
    let live = true;
    const load = async () => {
      const notes: string[] = [];
      let fromApi: LogEntry[] = [];
      let apiOk = false;
      if (apiEnabled) {
        const r = await api<{ items: unknown[] }>(`/api/log?invoice=${id}&limit=200`);
        if (r.ok) {
          apiOk = true;
          fromApi = r.data.items.map(fromApiEntry).filter((e): e is LogEntry => !!e);
        } else notes.push("The public log could not be read.");
      }
      const [s, b] = await Promise.all([fetchAgent(CONFIG.supplierAgentUrl, id), fetchAgent(CONFIG.buyerAgentUrl, id)]);
      if (!live) return;
      setState({ status: "ready", entries: mergeEntries(fromApi, [...(s ?? []), ...(b ?? [])]), notes, fromApi: apiOk });
    };
    void load();
    const t = window.setInterval(() => !document.hidden && void load(), 8_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [id]);
  return state;
}

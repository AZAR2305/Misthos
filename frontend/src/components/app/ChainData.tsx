"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { publicClient } from "@/lib/chain/client";
import { blockTimes, buildInvoices, fetchInvoiceLogs, type InvoiceRecord } from "@/lib/chain/invoices";
import { CONFIG } from "@/lib/config";

interface ChainData {
  /** unconfigured: no contract address for this build. */
  status: "unconfigured" | "loading" | "ready" | "error";
  error?: string;
  invoices: InvoiceRecord[];
  /** Block timestamp in unix seconds, once known. */
  time(block: bigint): number | undefined;
  refresh(): Promise<void>;
  updatedAt?: number;
  head?: bigint;
  rpcOk: boolean | null;
}

const Ctx = createContext<ChainData | null>(null);
export const useChainData = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChainData must be used inside ChainDataProvider");
  return v;
};

const POLL_MS = 8_000;

/** One shared, polled view of every InvoiceBook event: all pages read from this, so numbers always agree. */
export function ChainDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ChainData["status"]>(CONFIG.book ? "loading" : "unconfigured");
  const [error, setError] = useState<string>();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [head, setHead] = useState<bigint>();
  const [rpcOk, setRpcOk] = useState<boolean | null>(null);
  const [, bump] = useState(0);
  const times = useRef(new Map<bigint, number>());
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const client = publicClient();
      const block = await client.getBlockNumber();
      setHead(block);
      setRpcOk(true);
      if (!CONFIG.book) return;
      const logs = await fetchInvoiceLogs(client, CONFIG.book, CONFIG.deployBlock);
      const built = buildInvoices(logs);
      const blocks = [...new Set(logs.map((l) => l.blockNumber))].slice(-400);
      const cache = await blockTimes(client, blocks);
      for (const [b, t] of cache) times.current.set(b, t);
      setInvoices(built);
      setStatus("ready");
      setError(undefined);
      setUpdatedAt(Date.now());
      bump((n) => n + 1);
    } catch (e) {
      setRpcOk(false);
      setStatus("error");
      setError((e as Error).message.split("\n")[0]);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => !document.hidden && void refresh(), POLL_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  const value = useMemo<ChainData>(
    () => ({ status, error, invoices, time: (b) => times.current.get(b), refresh, updatedAt, head, rpcOk }),
    [status, error, invoices, refresh, updatedAt, head, rpcOk],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

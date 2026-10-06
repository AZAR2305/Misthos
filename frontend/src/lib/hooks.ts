"use client";

import { useCallback, useEffect, useState } from "react";
import { publicClient } from "./chain/client";
import { readUsdcBalance } from "./chain/invoices";
import { CONFIG } from "./config";

/** Real USDC balance of an address (6-decimal minor units), refreshed every 10 s. */
export function useUsdcBalance(address?: `0x${string}`) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!address) return setBalance(null);
    try {
      setBalance(await readUsdcBalance(publicClient(), CONFIG.usdc, address));
      setError(false);
    } catch {
      setError(true);
    }
  }, [address]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => !document.hidden && void load(), 10_000);
    return () => window.clearInterval(t);
  }, [load]);
  return { balance, error, reload: load };
}

export interface AgentHealthData {
  wallet?: { ok: boolean; detail?: string };
  modelConfigured?: boolean;
  invoiceBook?: string;
}

export type AgentHealth =
  | { state: "checking" }
  | { state: "offline"; reason: string }
  | { state: "online"; data: AgentHealthData };

/** Ask an agent process whether it is running. A browser cannot reach an agent that is not started or not allowing this origin. */
export function useAgentHealth(url: string): AgentHealth & { recheck(): void } {
  const [h, setH] = useState<AgentHealth>({ state: "checking" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return setH({ state: "offline", reason: "No agent is connected to this site." });
    let live = true;
    const ping = async () => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
        const body = (await r.json()) as { ok: boolean; data: AgentHealthData };
        const data = body.data;
        if (live) setH(r.ok && body.ok ? { state: "online", data } : { state: "offline", reason: "The agent answered with an error." });
      } catch {
        if (live) setH({ state: "offline", reason: "Not running, or it does not allow this website to talk to it." });
      }
    };
    void ping();
    const t = window.setInterval(() => !document.hidden && void ping(), 10_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [url, n]);
  return { ...h, recheck: () => setN((x) => x + 1) };
}

export interface AgentDecision {
  actor: "supplier_agent" | "buyer_agent";
  snapshot: { invoiceId?: string } & Record<string, unknown>;
  outcome: "auto_apply" | "needs_approval" | "rejected";
  reason: string;
  hash: `0x${string}`;
  prevHash: `0x${string}`;
  proposal: unknown;
}

/** An agent's decision log (hash-chained). Empty with `offline` when the agent is not running. */
export function useAgentDecisions(url: string) {
  const [state, setState] = useState<{ status: "checking" | "offline" | "ready"; entries: AgentDecision[] }>({ status: "checking", entries: [] });
  useEffect(() => {
    if (!url) return setState({ status: "offline", entries: [] });
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`${url}/decisions`, { signal: AbortSignal.timeout(2500) });
        const body = (await r.json()) as { ok: boolean; data?: { entries: AgentDecision[] } };
        if (live) setState(r.ok && body.ok && body.data ? { status: "ready", entries: body.data.entries } : { status: "offline", entries: [] });
      } catch {
        if (live) setState({ status: "offline", entries: [] });
      }
    };
    void load();
    const t = window.setInterval(() => !document.hidden && void load(), 5_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [url]);
  return state;
}

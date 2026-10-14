"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { api } from "./api";
import { parseObligations } from "./obligations-parse";
import { useObligations, type StoredObligations } from "./storage";

type Item = StoredObligations[number];

export interface DeclaredObligations {
  /** Where the list lives. On the account (server) the agent can read it; in the browser only this device can. */
  source: "server" | "browser";
  items: StoredObligations;
  status: "loading" | "ready" | "unavailable";
  error?: string;
  add(o: Item): Promise<void>;
  remove(id: string): Promise<void>;
  /** Items saved only in this browser while the account is on the server: the agent cannot see them. */
  browserOnly: StoredObligations;
  /** Copy the browser-only items to the account, then clear them from the browser. */
  moveToAccount(): Promise<void>;
}

/**
 * The buyer's declared payments (payroll, bills). With a signed-in buyer account they are stored on the server, because the
 * buyer agent reads them there to decide how much cash it may spend; kept only in a browser, the agent would see none and
 * could spend cash that payroll needs. Without accounts (wallet-only mode) they stay on this device and are sent to the agent
 * with each plan request, as before.
 */
export function useDeclaredObligations(): DeclaredObligations {
  const account = useAccount();
  const [local, setLocal] = useObligations();
  const server = account.mode === "on" && account.status === "ready" && account.me?.side === "buyer";
  const [rows, setRows] = useState<{ status: "loading" | "ready" | "unavailable"; items: StoredObligations; error?: string }>({ status: "loading", items: [] });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!server) return;
    let live = true;
    void api<unknown>("/api/obligations").then((r) => {
      if (!live) return;
      if (!r.ok) return setRows({ status: "unavailable", items: [], error: r.error.message });
      const items = parseObligations(r.data);
      setRows(items ? { status: "ready", items } : { status: "unavailable", items: [], error: "The server's answer was not understood." });
    });
    return () => {
      live = false;
    };
  }, [server, n]);

  const reload = () => setN((x) => x + 1);
  const post = (o: Item) => api("/api/obligations", { method: "POST", body: { label: o.label, amount: o.amount, dueDate: new Date(Number(o.dueSec) * 1000).toISOString(), kind: o.kind } });

  const add = useCallback(
    async (o: Item) => {
      if (!server) return setLocal([...local, o]);
      const r = await post(o);
      if (!r.ok) setRows((s) => ({ ...s, error: r.error.message }));
      reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server, local],
  );
  const remove = useCallback(
    async (id: string) => {
      if (!server) return setLocal(local.filter((x) => x.id !== id));
      const r = await api(`/api/obligations/${id}`, { method: "DELETE" });
      if (!r.ok) setRows((s) => ({ ...s, error: r.error.message }));
      reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server, local],
  );
  const moveToAccount = useCallback(async () => {
    for (const o of local) {
      const r = await post(o);
      if (!r.ok) return setRows((s) => ({ ...s, error: r.error.message }));
    }
    setLocal([]);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return server
    ? { source: "server", items: rows.items, status: rows.status, error: rows.error, add, remove, browserOnly: local, moveToAccount }
    : { source: "browser", items: local, status: "ready", add, remove, browserOnly: [], moveToAccount };
}

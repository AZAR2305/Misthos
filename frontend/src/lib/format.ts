"use client";

import { useEffect, useState } from "react";

/** Unix seconds as a short, readable date: "12 Nov 2026". */
export function dateOnly(sec: number | bigint): string {
  return new Date(Number(sec) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(sec: number | bigint): string {
  return new Date(Number(sec) * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Whole days from `now` to `due` (negative when past). */
export function daysUntil(due: number | bigint, now = Math.floor(Date.now() / 1000)): number {
  return Math.floor((Number(due) - now) / 86_400);
}

export function dueText(due: number | bigint, now = Math.floor(Date.now() / 1000)): string {
  const d = daysUntil(due, now);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  return `due in ${d} day${d === 1 ? "" : "s"}`;
}

export const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Current unix seconds, refreshed every 30 s so "due in N days" stays true while a page is open. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** A name for an invoice: the reference typed on this device if there is one, else a short id. */
export function invoiceName(id: string, meta: Record<string, { reference: string }>): string {
  const ref = meta[id.toLowerCase()]?.reference;
  return ref ? ref : `Invoice ${shortId(id)}`;
}

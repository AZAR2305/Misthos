"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

/**
 * Browser-local storage for the few things the chain does not hold: the reference and note a supplier typed, the
 * obligations a buyer listed for the allocator, and the offers issued from this browser. It is real user input, never
 * seeded, and it only lives on this device until the backend exists. Every read is validated and wrapped in try/catch
 * (storage can be blocked or cleared).
 */
export const metaSchema = z.record(
  z.string(),
  z.object({ reference: z.string().max(120), description: z.string().max(280), createdAt: z.number() }),
);
export type InvoiceMeta = z.infer<typeof metaSchema>;

export const obligationSchema = z.array(
  z.object({
    id: z.string(),
    label: z.string().max(80),
    amount: z.string().regex(/^\d+$/), // USDC minor units
    dueSec: z.string().regex(/^\d+$/),
    kind: z.enum(["payroll", "bill", "other"]),
  }),
);
export type StoredObligations = z.infer<typeof obligationSchema>;

export const offersSchema = z.record(z.string(), z.array(z.object({ code: z.string(), rateBps: z.number(), createdAt: z.number() })));
export type StoredOffers = z.infer<typeof offersSchema>;

export const roleSchema = z.enum(["supplier", "buyer"]);

const KEYS = {
  meta: "misthos.meta.v1",
  obligations: "misthos.obligations.v1",
  offers: "misthos.offers.v1",
  role: "misthos.roles.v1",
  connected: "misthos.connected.v1",
} as const;

function read<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("misthos-storage", { detail: key }));
  } catch {
    /* storage unavailable: the page still works, it just will not remember */
  }
}

/** A validated localStorage value as React state, kept in sync across components and tabs. */
function useStored<T>(key: string, schema: z.ZodType<T>, fallback: T): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const load = () => setValue(read(key, schema, fallback));
    load();
    setReady(true);
    const on = (e: Event) => {
      if (e instanceof StorageEvent ? e.key === key : (e as CustomEvent).detail === key) load();
    };
    window.addEventListener("storage", on);
    window.addEventListener("misthos-storage", on);
    return () => {
      window.removeEventListener("storage", on);
      window.removeEventListener("misthos-storage", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((next: T) => write(key, next), [key]);
  return [value, set, ready];
}

const EMPTY_META: InvoiceMeta = {};
const EMPTY_OBLIGATIONS: StoredObligations = [];
const EMPTY_OFFERS: StoredOffers = {};

export const useInvoiceMeta = () => useStored(KEYS.meta, metaSchema, EMPTY_META);
export const useObligations = () => useStored(KEYS.obligations, obligationSchema, EMPTY_OBLIGATIONS);
export const useIssuedOffers = () => useStored(KEYS.offers, offersSchema, EMPTY_OFFERS);
export type Role = z.infer<typeof roleSchema>;
const rolesSchema = z.record(z.string(), roleSchema);
const EMPTY_ROLES: Record<string, Role> = {};

/** The side a wallet chose (supplier or buyer), remembered per address on this device. Null until they choose. */
export function useRole(address?: string): [Role | null, (next: Role) => void, boolean] {
  const [all, setAll, ready] = useStored(KEYS.role, rolesSchema, EMPTY_ROLES);
  const key = address?.toLowerCase();
  const set = useCallback(
    (next: Role) => {
      if (key) setAll({ ...read(KEYS.role, rolesSchema, EMPTY_ROLES), [key]: next });
    },
    [key, setAll],
  );
  return [key ? (all[key] ?? null) : null, set, ready];
}

export const wasConnected = () => read(KEYS.connected, z.boolean(), false);
export const rememberConnected = (v: boolean) => write(KEYS.connected, v);

/** Save one invoice's note without touching the others. */
export function saveInvoiceMeta(id: string, entry: { reference: string; description: string }) {
  const all = read(KEYS.meta, metaSchema, EMPTY_META);
  write(KEYS.meta, { ...all, [id.toLowerCase()]: { ...entry, createdAt: Date.now() } });
}

export function saveIssuedOffer(invoiceId: string, code: string, rateBps: number) {
  const all = read(KEYS.offers, offersSchema, EMPTY_OFFERS);
  const key = invoiceId.toLowerCase();
  write(KEYS.offers, { ...all, [key]: [...(all[key] ?? []), { code, rateBps, createdAt: Date.now() }] });
}

import { CONFIG } from "./config";

/** The backend's envelope: { ok, data, error } (backend/README.md). Network failures become a typed error, never a throw. */
export interface ApiError {
  code: string;
  message: string;
}
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export const apiEnabled = !!CONFIG.apiUrl;

export async function api<T>(path: string, init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {}): Promise<ApiResult<T>> {
  if (!CONFIG.apiUrl) return { ok: false, error: { code: "UNAVAILABLE", message: "Unavailable: this site is not connected to a Misthos server." } };
  try {
    const res = await fetch(`${CONFIG.apiUrl}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = (await res.json()) as { ok: boolean; data: T; error: ApiError | null };
    return json.ok ? { ok: true, data: json.data } : { ok: false, error: json.error ?? { code: "ERROR", message: `The server answered ${res.status}.` } };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: `Unavailable: the Misthos server at ${CONFIG.apiUrl} is not reachable.` } };
  }
}

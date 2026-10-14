import fs from "node:fs";
let s = fs.readFileSync("src/agents/backend.ts", "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 70)); s = s.replace(a, b); };
rep(`export function signedReader(args: { backendUrl: string; wallet: WalletAdapter; domain: Domain; now?: () => number; timeoutMs?: number }): SignedReader {`,
    `/** The network call, replaceable so a test can talk to an API running in the same process. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function signedReader(args: { backendUrl: string; wallet: WalletAdapter; domain: Domain; now?: () => number; timeoutMs?: number; fetch?: FetchLike }): SignedReader {`);
rep(`      const res = await fetch(\`\${base}\${path}\`, {`, `      const res = await (args.fetch ?? fetch)(\`\${base}\${path}\`, {`);
rep(`export async function fetchExposureEvents(args: { backendUrl: string; side: "supplier" | "buyer"; owner: string; counterparty: string; timeoutMs?: number }): Promise<InvoiceEvent[]> {`,
    `export async function fetchExposureEvents(args: { backendUrl: string; side: "supplier" | "buyer"; owner: string; counterparty: string; timeoutMs?: number; fetch?: FetchLike }): Promise<InvoiceEvent[]> {`);
rep(`  const res = await fetch(\`\${args.backendUrl.replace(/\/$/, "")}/api/exposure?\${q}\`, { signal: AbortSignal.timeout(args.timeoutMs ?? 15_000) });`,
    `  const res = await (args.fetch ?? fetch)(\`\${args.backendUrl.replace(/\/$/, "")}/api/exposure?\${q}\`, { signal: AbortSignal.timeout(args.timeoutMs ?? 15_000) });`);
fs.writeFileSync("src/agents/backend.ts", s);
let l = fs.readFileSync("src/agents/log.ts", "utf8");
l = l.replace(`  policy?: { label: string; params: unknown };
}): DecisionStore {`, `  policy?: { label: string; params: unknown };
  /** Replaceable network call, for tests that run the API in the same process. */
  fetch?: FetchLike;
}): DecisionStore {`);
l = l.replace(`push: backendUrl ? (entries) => deliver(backendUrl, entries) : undefined,`, `push: backendUrl ? (entries) => deliver(backendUrl, entries, args.fetch) : undefined,`);
l = l.replace(`async function deliver(backendUrl: string, entries: readonly LoggedDecision[]) {
  const res = await fetch(`, `async function deliver(backendUrl: string, entries: readonly LoggedDecision[], doFetch: FetchLike | (typeof fetch) = fetch) {
  const res = await (doFetch as typeof fetch)(`);
l = l.replace(`import { PolicyBook } from "./policybook.js";`, `import type { FetchLike } from "./backend.js";
import { PolicyBook } from "./policybook.js";`);
fs.writeFileSync("src/agents/log.ts", l);

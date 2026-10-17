import { join } from "node:path";
import { decisionTypedData, type Domain } from "../core/index.js";
import type { WalletAdapter } from "../wallets/types.js";
import type { FetchLike } from "./backend.js";
import { PolicyBook } from "./policybook.js";
import type { Vault } from "./vault.js";
import { DecisionStore, type LoggedDecision } from "./store.js";

/**
 * The decision log of one agent process, wired for real use: kept in a file so it survives a restart, signed entry by
 * entry with the agent's wallet, and delivered to the Misthos API (which re-checks the chain and the signature) when
 * BACKEND_URL is set. Without BACKEND_URL the log stays on this machine and says so in /decisions.
 */
export function openDecisionStore(args: {
  name: "supplier" | "buyer";
  dataDir: string;
  wallet: WalletAdapter;
  domain: Domain;
  backendUrl?: string;
  /** This agent's private parameters. They are versioned in a local file; the log carries only the version and a salted commitment. */
  policy?: { label: string; params: unknown };
  /** Encrypts the private files (policy records, decision preimages) at rest. */
  vault?: Vault;
  /** Replaceable network call, for tests that run the API in the same process. */
  fetch?: FetchLike;
  /** One line per decision for the operator's terminal. */
  echo?: (line: string) => void;
}): DecisionStore {
  const { name, dataDir, wallet, domain, backendUrl } = args;
  const stamp = args.policy ? new PolicyBook(join(dataDir, `${name}-policy.jsonl`), undefined, args.vault).use(args.policy.label, args.policy.params, Math.floor(Date.now() / 1000)) : undefined;
  return new DecisionStore({
    policy: stamp ? () => stamp : undefined,
    vault: args.vault,
    echo: args.echo,
    file: join(dataDir, `${name}-decisions.jsonl`),
    attest: async (e) => {
      const signer = await wallet.address();
      const signature = await wallet.signTypedData(decisionTypedData(domain, e) as never);
      return { signer, signature };
    },
    push: backendUrl ? (entries) => deliver(backendUrl, entries, args.fetch) : undefined,
  });
}

async function deliver(backendUrl: string, entries: readonly LoggedDecision[], doFetch: FetchLike | typeof fetch = fetch) {
  const res = await (doFetch as typeof fetch)(`${backendUrl.replace(/\/$/, "")}/api/log/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      entries: entries.map((e) => ({
        seq: e.seq,
        prevHash: e.prevHash,
        hash: e.hash,
        actor: e.actor,
        invoiceRef: e.invoiceRef,
        reasonCode: e.reasonCode,
        at: e.at,
        snapshot: e.snapshot,
        proposal: e.proposal,
        outcome: e.outcome,
        reason: e.reason,
        signer: e.signer,
        signature: e.signature,
      })),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
  if (!res.ok || !body.ok) throw new Error(body.error?.message ?? `the API answered ${res.status}`);
}

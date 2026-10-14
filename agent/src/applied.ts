import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DecisionStore, PolicyBook } from "./agents/index.js";
import { vaultFromEnv, type Vault } from "./agents/vault.js";
import { loadEnvFile } from "./config.js";

/**
 * Were the owner's limits really applied? For each decision in an agent's own log, report from what the agent recorded at the time:
 *   - was an exposure (risk) limit read and checked, and which version of it
 *   - was the payment calendar read, and how many entries it had (never their amounts)
 *   - was the ERC-8004 registry read, and what it found
 * A decision made with no limit, an unreadable calendar or no registry reading is listed as NOT applied. This is the evidence a pilot run needs: "the
 * limits were on" must be shown from the log, never assumed. Nothing here calls the network or a model.
 */
export interface AppliedRow {
  hash: string;
  invoice: string | null;
  at: number | undefined;
  /** ACCEPT or the reason code. */
  result: string;
  exposure: { applied: boolean; version?: string; result?: string };
  calendar: { applied: boolean; entries?: number; declaredNone?: boolean };
  registry: { applied: boolean; result?: string };
}

export function appliedReport(dataDir: string, name: "buyer" | "supplier", vault?: Vault): { rows: AppliedRow[]; summary: Record<string, number>; notApplied: AppliedRow[] } {
  const store = new DecisionStore({ file: join(dataDir, `${name}-decisions.jsonl`), vault });
  void new PolicyBook(join(dataDir, `${name}-policy.jsonl`), undefined, vault); // refuses a sealed file without the key, like the audit does
  const rows: AppliedRow[] = [];
  for (const e of store.all()) {
    const pre = store.preimageOf(e.hash) as { inputs?: { treasury?: { obligations?: unknown[] } | null; exposure?: { kind?: string } } } | undefined;
    const snap = (e.snapshot ?? {}) as { exposure?: { policyVersion?: string; result?: string }; reputation?: { result?: string }; result?: { code?: string } };
    if (!pre?.inputs) continue; // entries without kept inputs (for example the supplier's rung records) are not buyer decisions
    const treasury = pre.inputs.treasury;
    rows.push({
      hash: e.hash,
      invoice: e.invoiceRef ?? null,
      at: e.at,
      result: snap.result?.code ?? e.reasonCode ?? "?",
      exposure: { applied: pre.inputs.exposure?.kind === "on" && !!snap.exposure?.policyVersion, version: snap.exposure?.policyVersion, result: snap.exposure?.result },
      calendar: treasury ? { applied: true, entries: treasury.obligations?.length ?? 0, declaredNone: (treasury.obligations?.length ?? 0) === 0 } : { applied: false },
      registry: { applied: snap.reputation?.result === "read" || snap.reputation?.result === "none", result: snap.reputation?.result },
    });
  }
  const count = (f: (r: AppliedRow) => boolean) => rows.filter(f).length;
  return {
    rows,
    summary: { decisions: rows.length, exposureApplied: count((r) => r.exposure.applied), calendarApplied: count((r) => r.calendar.applied), registryApplied: count((r) => r.registry.applied) },
    notApplied: rows.filter((r) => !r.exposure.applied || !r.calendar.applied || !r.registry.applied),
  };
}

function main() {
  loadEnvFile();
  const [dir = process.env.AGENT_DATA_DIR ?? ".agent-data", name = "buyer"] = process.argv.slice(2);
  if (name !== "buyer" && name !== "supplier") {
    console.error("usage: pnpm --filter @misthos/agent applied-report [data dir] [buyer|supplier]");
    process.exit(2);
  }
  try {
    const r = appliedReport(dir, name, process.env.AGENT_STORE_KEY ? vaultFromEnv(process.env.AGENT_STORE_KEY) : undefined);
    console.log(`Decisions with kept inputs: ${r.summary.decisions}`);
    console.log(`  exposure limit applied:  ${r.summary.exposureApplied} of ${r.summary.decisions}`);
    console.log(`  payment calendar read:   ${r.summary.calendarApplied} of ${r.summary.decisions}`);
    console.log(`  registry read:           ${r.summary.registryApplied} of ${r.summary.decisions}`);
    for (const x of r.rows) console.log(`  ${x.hash.slice(0, 12)}…  ${x.result.padEnd(20)} limit=${x.exposure.applied ? x.exposure.version + "/" + x.exposure.result : "NOT APPLIED"}  calendar=${x.calendar.applied ? x.calendar.entries + " entries" : "NOT READ"}  registry=${x.registry.applied ? x.registry.result : "NOT READ"}`);
    if (r.notApplied.length) console.log(`\n${r.notApplied.length} decision(s) ran without every check. Say so when you describe this run.`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

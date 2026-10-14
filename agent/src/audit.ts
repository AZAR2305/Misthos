import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { canonicalJson, commitTo, decideBuyerOffer, hashDecision, planLadder, type BuyerDecisionInput, type SupplierPrefs } from "./core/index.js";
import { DecisionStore, PolicyBook, type LoggedDecision } from "./agents/index.js";

/**
 * Replay and verify one logged decision (SRS NFR-04 and FR-10). Given the agent's own files (its decision log, which holds the
 * private inputs, and its policy book, which holds the parameters and salt), it checks that:
 *   1. the entry hashes to what was logged (so it is the entry that went on chain as `decisionHash`);
 *   2. the policy version it names exists and its salted commitment matches;
 *   3. the inputs it kept match the inputs commitment in the public entry;
 *   4. running the same pure decision function on those inputs gives the same decision that was logged.
 * It is a tool for the owner and an auditor, not part of any page. Nothing here calls a model or the network.
 */
const big = z.union([z.string().regex(/^-?\d+$/), z.number().int()]).transform((v) => BigInt(v));
const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().nullable().transform((v) => v ?? undefined);

const buyerInputs = z.object({
  nowSec: big,
  candidate: z.object({ id: z.string(), face: big, dueSec: big, status: z.enum(["approved", "registered", "settled", "disputed"]), offerRateBps: z.number().int(), offerExpirySec: big, reputationBlocked: opt(z.boolean()) }),
  policy: z.object({ hurdleAprBps: z.number().int(), liquidityFloor: big, perInvoiceCap: big, dailyCap: big, humanAbove: big, feeBps: z.number().int() }),
  treasury: z.union([z.null(), z.object({ cash: big, obligations: z.array(z.object({ id: z.string(), dueSec: big, amount: big })) })]),
  spentToday: big,
  exposure: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("off") }),
    z.object({ kind: z.literal("unreadable") }),
    z.object({
      kind: z.literal("on"),
      policy: z.object({ version: z.string(), newCounterpartyLimit: big, maxLimit: big, growthBps: z.number().int(), lookbackDays: z.number().int(), graceSeconds: z.number().int() }),
      events: z.array(
        z.object({
          invoiceId: z.string(),
          state: z.enum(["approved", "settled_early", "settled_on_due", "disputed"]),
          face: big,
          outflow: opt(big),
          dueSec: big,
          settledAtSec: opt(big),
          txHash: opt(z.string()),
          logIndex: opt(z.number().int()),
        }),
      ),
    }),
  ]),
  reputation: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("off") }),
      z.object({ kind: z.literal("unavailable") }),
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("read"), recent: z.array(z.object({ disputed: z.boolean() })) }),
    ])
    .optional(),
  newAddressCap: opt(big),
  decision: z.string(),
});

const supplierInputs = z.object({
  prefs: z.object({ costOfWaitingAprBps: z.number().int(), maxRateBps: z.number().int(), startRateBps: z.number().int(), stepBps: z.number().int() }),
  pastAcceptedBps: z.array(z.number().int()),
  proposedStartBps: opt(z.number().int()),
  proposedMaxBps: opt(z.number().int()),
  ceilingBps: z.number().int(),
  rungs: z.array(z.number().int()),
});

export interface AuditCheck {
  name: "entry hash" | "policy commitment" | "inputs commitment" | "replay";
  ok: boolean;
  detail: string;
}
export interface AuditReport {
  ok: boolean;
  hash: string;
  policyVersion?: string;
  checks: AuditCheck[];
  /** The replayed decision, in plain words and numbers, for the auditor. */
  replay?: string[];
}

export function auditDecision(entry: LoggedDecision, preimage: { policyVersion: string; inputs: unknown } | undefined, book: PolicyBook): AuditReport {
  const checks: AuditCheck[] = [];
  const done = (replay?: string[]): AuditReport => ({ ok: checks.every((c) => c.ok), hash: entry.hash, policyVersion: (entry.snapshot as { policyVersion?: string })?.policyVersion, checks, replay });
  const snap = (entry.snapshot ?? {}) as { policyVersion?: string; policyCommitment?: string; inputsCommitment?: string; result?: { code?: string } };

  const recomputed = hashDecision({ prevHash: entry.prevHash, actor: entry.actor, snapshot: entry.snapshot, proposal: entry.proposal, outcome: entry.outcome, reason: entry.reason });
  checks.push({ name: "entry hash", ok: recomputed === entry.hash, detail: recomputed === entry.hash ? "the entry hashes to the logged value" : "the entry does not hash to its logged value" });

  const policy = snap.policyVersion ? book.byVersion(snap.policyVersion) : undefined;
  if (!snap.policyVersion || !policy) {
    checks.push({ name: "policy commitment", ok: false, detail: snap.policyVersion ? `policy version ${snap.policyVersion} is not in the policy file` : "the entry names no policy version" });
    return done();
  }
  const policyOk = commitTo({ version: snap.policyVersion, params: policy.params }, policy.salt) === snap.policyCommitment;
  checks.push({ name: "policy commitment", ok: policyOk, detail: policyOk ? `${snap.policyVersion} matches its commitment` : `${snap.policyVersion} does not match the commitment in the entry` });

  if (!preimage) {
    checks.push({ name: "inputs commitment", ok: false, detail: "this agent did not keep the private inputs for this entry" });
    return done();
  }
  const inputsOk = commitTo(JSON.parse(canonicalJson(preimage.inputs)), policy.salt) === snap.inputsCommitment && preimage.policyVersion === snap.policyVersion;
  checks.push({ name: "inputs commitment", ok: inputsOk, detail: inputsOk ? "the kept inputs match the commitment in the entry" : "the kept inputs do not match the commitment in the entry" });
  if (!inputsOk) return done();

  try {
    if (entry.actor === "buyer_agent") {
      const i = buyerInputs.parse(preimage.inputs);
      const input = { ...i, candidate: { ...i.candidate } } as unknown as BuyerDecisionInput;
      const d = decideBuyerOffer(input);
      const code = d.result === "accept" ? "ACCEPT" : d.code;
      const same = code === i.decision && code === snap.result?.code;
      checks.push({ name: "replay", ok: same, detail: same ? `replaying the inputs gives ${code}, as logged` : `replay gives ${code}, but ${i.decision} was decided and ${snap.result?.code ?? "nothing"} was logged` });
      return done(d.steps.map((s) => `${s.check}: ${s.result}`).concat(`decision: ${code}`));
    }
    const i = supplierInputs.parse(preimage.inputs);
    const plan = planLadder({ prefs: i.prefs as SupplierPrefs, pastAcceptedBps: i.pastAcceptedBps, proposedStartBps: i.proposedStartBps, proposedMaxBps: i.proposedMaxBps });
    const same = canonicalJson(plan.rungs) === canonicalJson(i.rungs) && plan.ceilingBps === i.ceilingBps;
    checks.push({ name: "replay", ok: same, detail: same ? "replaying the inputs gives the same ladder, as logged" : "replay gives a different ladder from the one that was used" });
    return done([`ceiling ${plan.ceilingBps} bps`, `rungs ${plan.rungs.join(", ")} bps`]);
  } catch (e) {
    checks.push({ name: "replay", ok: false, detail: `the kept inputs could not be read: ${(e as Error).message.slice(0, 160)}` });
    return done();
  }
}

/** Load an agent's files from its data directory and audit one entry by hash (a prefix of at least 10 characters is enough). */
export function auditFromFiles(dataDir: string, name: "buyer" | "supplier", hashOrPrefix: string): AuditReport {
  const store = new DecisionStore({ file: join(dataDir, `${name}-decisions.jsonl`) }); // throws if the chain was changed
  const book = new PolicyBook(join(dataDir, `${name}-policy.jsonl`));
  const matches = store.all().filter((e) => e.hash.startsWith(hashOrPrefix.toLowerCase()));
  if (matches.length !== 1) throw new Error(matches.length ? "That prefix matches more than one entry; give more characters." : "No entry in this log has that hash.");
  const entry = matches[0]!;
  return auditDecision(entry, store.preimageOf(entry.hash), book);
}

function main() {
  const [hash, dir = process.env.AGENT_DATA_DIR ?? ".agent-data", name = "buyer"] = process.argv.slice(2);
  if (!hash || (name !== "buyer" && name !== "supplier")) {
    console.error("usage: pnpm --filter @misthos/agent audit-decision <hash or prefix> [data dir] [buyer|supplier]");
    process.exit(2);
  }
  try {
    const r = auditFromFiles(dir, name, hash);
    console.log(`${r.ok ? "VERIFIED" : "FAILED"}  ${r.hash}${r.policyVersion ? `  (${r.policyVersion})` : ""}`);
    for (const c of r.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
    for (const line of r.replay ?? []) console.log(`  ${line}`);
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

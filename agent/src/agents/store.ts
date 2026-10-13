import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { GENESIS_HASH, canonicalJson, findPrivateKey, hashDecision, verifyChain, type DecisionEntry, type StoredDecision } from "../core/index.js";

/**
 * Append-only, hash-chained decision log (spec 8.4). `hash` is what goes on chain as `decisionHash` in settleEarly.
 *
 * It is the real log for one agent process and it survives a restart: every entry is appended to a file the moment it is
 * decided, the chain is re-verified when the file is loaded (a tampered file stops the agent rather than being trusted), and
 * each entry is then signed by the agent's wallet and pushed to the backend, which re-checks the hash chain and the
 * signature before it stores anything. Signing and pushing never sit in the decision path: a slow wallet or an unreachable
 * backend delays the proof, not the decision.
 *
 * reasonCode records why an item waits for a human (MODEL_UNAVAILABLE, SESSION_EXPIRED, ...): spec 0.5 and 8.5 #6.
 */
export type DecisionOutcome = DecisionEntry["outcome"];

export interface DecisionInput {
  actor: DecisionEntry["actor"];
  invoiceId: string;
  /** Numbers and opaque ids only. Invoice descriptions and other free text never go in a snapshot (spec 8.5 #1). */
  snapshot: unknown;
  proposal: unknown;
  outcome: DecisionOutcome;
  reasonCode?: string;
  reason: string;
}

/** One logged decision as it is stored, signed and pushed. */
export interface LoggedDecision extends StoredDecision {
  /** Place in this agent's chain, from 0. */
  seq: number;
  invoiceRef: string;
  reasonCode?: string;
  /** Unix seconds when it was decided. */
  at: number;
  signer?: `0x${string}`;
  signature?: `0x${string}`;
}

export interface DecisionStoreOptions {
  /** JSON-lines file. Without one the log lives in memory only (tests). */
  file?: string;
  /** Sign an entry with the agent wallet. */
  attest?: (e: { hash: `0x${string}`; prevHash: `0x${string}`; actor: DecisionEntry["actor"]; seq: number }) => Promise<{ signer: `0x${string}`; signature: `0x${string}` }>;
  /** Deliver signed entries to the backend. Throw to retry later. */
  push?: (entries: readonly LoggedDecision[]) => Promise<void>;
  retryMs?: number;
  warn?: (message: string) => void;
}

type Line =
  | ({ k: "e" } & LoggedDecision)
  | { k: "s"; hash: `0x${string}`; signer: `0x${string}`; signature: `0x${string}` }
  | { k: "p"; hashes: `0x${string}`[] };

/** What is hashed must equal what is stored and reloaded, so bigints become decimal strings before anything is hashed. */
const plain = <T>(v: T): T => (v === undefined ? (null as T) : (JSON.parse(canonicalJson(v)) as T));

export class DecisionStore {
  private entries: LoggedDecision[] = [];
  private pushed = new Set<string>();
  private pumping = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly o: DecisionStoreOptions = {}) {
    if (o.file) this.load(o.file);
  }

  private load(file: string) {
    if (!existsSync(file)) return;
    const byHash = new Map<string, LoggedDecision>();
    for (const [n, raw] of readFileSync(file, "utf8").split("\n").entries()) {
      if (!raw.trim()) continue;
      let line: Line;
      try {
        line = JSON.parse(raw) as Line;
      } catch {
        throw new Error(`The decision log ${file} is damaged at line ${n + 1}. Move it aside to start a new log.`);
      }
      if (line.k === "e") {
        const { k: _k, ...e } = line;
        this.entries.push(e);
        byHash.set(e.hash, e);
      } else if (line.k === "s") {
        const e = byHash.get(line.hash);
        if (e) Object.assign(e, { signer: line.signer, signature: line.signature });
      } else for (const h of line.hashes) this.pushed.add(h);
    }
    const v = verifyChain(this.entries);
    if (!v.ok) throw new Error(`The decision log ${file} does not verify (entry ${v.badIndex}). It was changed after it was written; move it aside to start a new log.`);
  }

  private write(line: Line) {
    if (!this.o.file) return;
    mkdirSync(dirname(this.o.file), { recursive: true });
    appendFileSync(this.o.file, JSON.stringify(line) + "\n");
  }

  append(input: DecisionInput, nowSec: number): LoggedDecision {
    // The log is public. A private policy value in a snapshot or proposal is a bug, so refuse it rather than publish it.
    const leaked = findPrivateKey(input.snapshot) ?? findPrivateKey(input.proposal);
    if (leaked) throw new Error(`The decision log is public: "${leaked}" is a private policy value and cannot be logged.`);
    const prevHash = this.entries.at(-1)?.hash ?? GENESIS_HASH;
    const entry: DecisionEntry = {
      prevHash,
      actor: input.actor,
      snapshot: plain({ invoiceId: input.invoiceId, ...(input.snapshot as object) }),
      proposal: plain(input.proposal),
      outcome: input.outcome,
      reason: input.reasonCode ? `${input.reasonCode}: ${input.reason}` : input.reason,
    };
    const stored: LoggedDecision = { ...entry, hash: hashDecision(entry), seq: this.entries.length, invoiceRef: input.invoiceId, reasonCode: input.reasonCode, at: nowSec };
    this.entries.push(stored);
    this.write({ k: "e", ...stored });
    this.kick();
    return stored;
  }

  all(): readonly LoggedDecision[] {
    return this.entries;
  }

  forInvoice(invoiceId: string): LoggedDecision[] {
    return this.entries.filter((e) => e.invoiceRef === invoiceId);
  }

  /** GET /decisions: recompute the chain. */
  verify() {
    return verifyChain(this.entries);
  }

  /** How many entries are signed and how many the backend has acknowledged. */
  status() {
    return { entries: this.entries.length, signed: this.entries.filter((e) => e.signature).length, delivered: this.pushed.size };
  }

  /** Sign what is unsigned and deliver what is signed. Safe to call any time; it runs one pass at a time. */
  kick() {
    if (this.pumping || (!this.o.attest && !this.o.push)) return;
    this.pumping = true;
    void this.pump().finally(() => {
      this.pumping = false;
    });
  }

  private pending() {
    return this.entries.some((e) => (this.o.attest && !e.signature) || (this.o.push && e.signature && !this.pushed.has(e.hash)));
  }

  private async pump(): Promise<void> {
    try {
      if (this.o.attest) {
        for (const e of this.entries) {
          if (e.signature) continue;
          const { signer, signature } = await this.o.attest({ hash: e.hash, prevHash: e.prevHash, actor: e.actor, seq: e.seq });
          Object.assign(e, { signer, signature });
          this.write({ k: "s", hash: e.hash, signer, signature });
        }
      }
      if (this.o.push) {
        const todo = this.entries.filter((e) => e.signature && !this.pushed.has(e.hash));
        for (let i = 0; i < todo.length; i += 50) {
          const batch = todo.slice(i, i + 50);
          await this.o.push(batch);
          for (const e of batch) this.pushed.add(e.hash);
          this.write({ k: "p", hashes: batch.map((e) => e.hash) });
        }
      }
      if (this.pending()) return this.pump(); // something was decided while this pass ran
    } catch (e) {
      (this.o.warn ?? console.warn)(`[decision log] signing or delivery is waiting: ${(e as Error).message}`);
      this.timer = setTimeout(() => this.kick(), this.o.retryMs ?? 10_000);
      this.timer.unref?.();
    }
  }
}

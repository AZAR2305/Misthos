import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson, commitTo } from "../core/index.js";
import type { PolicyStamp } from "./store.js";

/**
 * The agent's private policy, versioned (SRS FR-10: "policy version used for the decision"). Each time the parameters change a
 * new version is written to a local file together with a fresh secret salt; a restart with the same parameters reuses the
 * version in force. Only the version label and the salted commitment ever reach the public log. The parameters and salt stay in
 * this file, so the owner can later show an auditor exactly what a decision ran under. The file is private: keep it out of git.
 */
export interface PolicyRecord {
  n: number;
  label: string;
  /** The parameters as plain JSON (bigint as decimal strings). */
  params: unknown;
  salt: `0x${string}`;
  commitment: `0x${string}`;
  at: number;
}

const plain = (v: unknown) => JSON.parse(canonicalJson(v)) as unknown;
const newSalt = () => ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;

export class PolicyBook {
  private records: PolicyRecord[] = [];

  constructor(
    private readonly file: string | undefined,
    private readonly salt: () => `0x${string}` = newSalt,
  ) {
    if (file && existsSync(file)) {
      for (const [i, raw] of readFileSync(file, "utf8").split("\n").entries()) {
        if (!raw.trim()) continue;
        try {
          this.records.push(JSON.parse(raw) as PolicyRecord);
        } catch {
          throw new Error(`The policy file ${file} is damaged at line ${i + 1}. Move it aside to start a new one; older decisions then cannot be replayed.`);
        }
      }
    }
  }

  /** Record these parameters as the policy in force. A new version is made only when they differ from the latest one. */
  use(label: string, params: unknown, nowSec: number): PolicyStamp {
    const wanted = plain(params);
    const latest = [...this.records].reverse().find((r) => r.label === label);
    if (latest && canonicalJson(latest.params) === canonicalJson(wanted)) return stamp(latest);
    const n = (latest?.n ?? 0) + 1;
    const salt = this.salt();
    const version = `${label}-${n}`;
    const rec: PolicyRecord = { n, label, params: wanted, salt, commitment: commitTo({ version, params: wanted }, salt), at: nowSec };
    this.records.push(rec);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(rec) + "\n");
    }
    return stamp(rec);
  }

  /** The parameters and salt behind a version label such as "buyer-policy-2", for the owner or an auditor. */
  byVersion(version: string): PolicyRecord | undefined {
    return this.records.find((r) => `${r.label}-${r.n}` === version);
  }

  all(): readonly PolicyRecord[] {
    return this.records;
  }
}

const stamp = (r: PolicyRecord): PolicyStamp => ({ version: `${r.label}-${r.n}`, commitment: r.commitment, salt: r.salt });

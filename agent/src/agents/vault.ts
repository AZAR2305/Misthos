import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Encryption at rest for the values that stay with an agent: policy parameters and salts, decision preimages, and the buyer's
 * payment calendar. AES-256-GCM with a fresh 12-byte nonce per record. The key comes from the environment (AGENT_STORE_KEY) and is
 * never written anywhere by this code. Losing the key means losing these private records (the public log and the chain are unaffected).
 *
 * The prefix `enc1:` marks a sealed value so a reader can tell it from legacy plaintext and from a damaged file.
 */
export const SEALED_PREFIX = "enc1:";

export class VaultError extends Error {
  constructor(
    readonly code: "NO_KEY" | "BAD_KEY" | "WRONG_KEY_OR_DAMAGED",
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

export class Vault {
  private readonly key: Buffer;

  /** `key` is 32 bytes as 64 hex characters or as base64. */
  constructor(key: string) {
    const k = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
    if (k.length !== 32) throw new VaultError("BAD_KEY", "AGENT_STORE_KEY must be 32 random bytes, as 64 hex characters or base64. Make one with: openssl rand -base64 32");
    this.key = k;
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return SEALED_PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
  }

  open(sealed: string): string {
    if (!sealed.startsWith(SEALED_PREFIX)) throw new VaultError("WRONG_KEY_OR_DAMAGED", "This value is not sealed.");
    const raw = Buffer.from(sealed.slice(SEALED_PREFIX.length), "base64");
    try {
      const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    } catch {
      throw new VaultError("WRONG_KEY_OR_DAMAGED", "A private record could not be decrypted: the key is wrong or the file was changed.");
    }
  }
}

/** Read the vault from the environment. Without a key a process that holds private values must not start (fail closed). */
export function vaultFromEnv(value: string | undefined): Vault {
  if (!value) throw new VaultError("NO_KEY", "Set AGENT_STORE_KEY in agent/.env (32 random bytes: openssl rand -base64 32). Private values are stored encrypted with it.");
  return new Vault(value);
}

/** One small sealed JSON document in a file, replaced atomically. */
export class SealedFile<T> {
  constructor(
    private readonly file: string,
    private readonly vault: Vault,
  ) {}

  exists(): boolean {
    return existsSync(this.file);
  }

  read(): T | undefined {
    if (!existsSync(this.file)) return undefined;
    return JSON.parse(this.vault.open(readFileSync(this.file, "utf8").trim())) as T;
  }

  write(value: T): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.vault.seal(JSON.stringify(value)), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

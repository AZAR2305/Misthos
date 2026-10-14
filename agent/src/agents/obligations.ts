import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { SealedFile, type Vault } from "./vault.js";

/**
 * The buyer's declared upcoming payments (payroll, bills). They are the cash the agent must hold back, so they are private:
 * kept in an encrypted file on the buyer agent's own machine and never sent to the shared Misthos server. They are marked
 * "declared" everywhere, because no chain can confirm them; the on-chain payables are the verified part.
 *
 * A calendar that was never declared is "unavailable" and the buyer accepts nothing (fail closed). An empty but declared
 * calendar is a deliberate statement that there are no obligations.
 */
export const obligationInput = z.strictObject({
  label: z.string().min(1).max(80),
  amount: z.string().regex(/^[1-9]\d{0,17}$/, "amount is a whole number of USDC minor units (6 decimals), above zero"),
  dueSec: z.string().regex(/^\d{1,12}$/),
  kind: z.enum(["payroll", "bill", "other"]).default("other"),
});
export type ObligationInput = z.infer<typeof obligationInput>;

export interface StoredObligation extends ObligationInput {
  id: string;
}
interface Doc {
  declared: true;
  items: StoredObligation[];
}

export class ObligationUnavailableError extends Error {
  readonly code = "OBLIGATIONS_UNDECLARED";
  constructor() {
    super("The payment calendar has not been declared. Add your upcoming payments, or declare that you have none.");
    this.name = "ObligationUnavailableError";
  }
}

export class ObligationStore {
  private readonly file: SealedFile<Doc>;

  constructor(dataDir: string, vault: Vault, name = "buyer") {
    this.file = new SealedFile<Doc>(join(dataDir, `${name}-obligations.enc`), vault);
  }

  /** Throws ObligationUnavailableError when the calendar was never declared. */
  list(): StoredObligation[] {
    const d = this.file.read();
    if (!d) throw new ObligationUnavailableError();
    return d.items;
  }

  declared(): boolean {
    return this.file.exists();
  }

  declareNone(): void {
    if (!this.file.exists()) this.file.write({ declared: true, items: [] });
  }

  add(input: ObligationInput, now = Math.floor(Date.now() / 1000)): StoredObligation {
    const parsed = obligationInput.parse(input);
    if (Number(parsed.dueSec) <= now - 86_400) throw new Error("That payment's due date is in the past.");
    const items = this.file.read()?.items ?? [];
    if (items.length >= 200) throw new Error("Too many entries. Remove old ones first.");
    const item: StoredObligation = { id: randomUUID(), ...parsed };
    this.file.write({ declared: true, items: [...items, item] });
    return item;
  }

  remove(id: string): boolean {
    const d = this.file.read();
    if (!d) return false;
    const items = d.items.filter((x) => x.id !== id);
    if (items.length === d.items.length) return false;
    this.file.write({ declared: true, items });
    return true;
  }
}

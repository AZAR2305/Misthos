# Data audit and privacy split (14 Oct 2026)

Rule: chain events are the source of truth for public facts. The shared server (backend) is a **rebuildable cache plus a minimal operational
store**. Private values live only with the agent that owns them, in an encrypted local store. Arc is public, so nothing private goes on chain.

Classes: **chain** = a public chain fact; **cache** = derived from chain events and rebuildable; **ops** = minimal operational data;
**limit** = an exposure (risk) limit, kept server-side on purpose; **private** = must not be on the server.

## 1. What the backend stored before this change, and what it stores now
| Table | Fields of interest | Class | Status |
|---|---|---|---|
| `chain_events` | tx hash, log index, block, event name, payload (invoice id, supplier, buyer, token, amount, due date, ref hash) | cache of chain | kept; **rebuilt from the chain in a test** |
| `chain_blocks` | block number, time | cache of chain | kept; rebuilt |
| `indexer_state` | last block read | cache | kept; rebuilt |
| `accounts` | wallet address, side, org id, created | ops | kept. **No email, no Google id** (dropped in migration 007) |
| `organizations` | name (defaults to the wallet address), role | ops | kept |
| `sessions` | SHA-256 of the session token, expiry | ops | kept |
| `auth_challenges` | one-time sign-in message, address, expiry, used flag | ops | kept |
| `wallets` | agent wallet address linked to a business | ops | kept |
| `agent_link_codes` | SHA-256 of a one-time link code, expiry, used | ops | kept (code never stored) |
| `standing_offers` | SHA-256 of a claim token, rate, expiry, supplier payout address, the supplier's signed offer once claimed | ops | kept; the signed offer is public once settled |
| `jobs` | idempotency key, kind, payload (invoice and signature), status | ops | kept; payloads are public invoice data |
| `decisions` | the agents' **public** decision log: hash chain, policy version, a salted commitment to private inputs, reason code, signature | public by design | kept; the API refuses a snapshot that contains a private policy key (tested) |
| `exposure_policies`, `exposure_policy_versions` | an owner's starting limit, maximum and growth for new counterparties | **limit** | **kept server-side on purpose**, see section 2 |
| `agents` | agent wallet, role, ERC-8004 id | ops/public | kept |
| `policies` | buyer hurdle, liquidity floor, per-invoice cap, daily cap, human-approval threshold | **private** | **dropped (migration 008); routes deleted** |
| `supplier_prefs` | supplier cost of waiting, ceiling, start rate, step | **private** | **dropped; routes deleted** |
| `obligations` | buyer's payroll and bills: label, amount, due date | **private** | **dropped; moved to the buyer agent's encrypted store** |
| `users` | an email column | would be PII | **dropped** (unused) |
| `rounds`, `bids` | `reserve_bps` (a buyer's private reserve) for the early-pay auction | **private** | **dropped** (auction not built) |
| `invoices`, `offers`, `messages`, `reputation_events`, `screenings`, `settlements`, `journal_entries` | original design tables | none used | empty legacy tables with no private columns; no code writes them. Kept only because `schema.test.ts` exercises their constraints. **VERIFY before the public repo: delete them or keep them documented as unused.** |

## 2. What is still server-side, disclosed
- **Exposure (risk) limits** (`exposure_policies`): a business's starting limit, maximum and growth. These are server-side because the **invoice registration gate** enforces the
  supplier's limit when a supplier registers an invoice through the relayer, and a limit that only the owner's machine knows cannot be enforced there.
  Mismatch with the plan: the plan said the *buyer's* limit stays server-side; in this build the gate enforces the *supplier's* limit, and the buyer's limit is read only by the
  buyer's own agent. **The buyer's limit could move to the agent's local store; it is still on the server today** and that is a disclosed limitation, not a design claim.
- **Agent wallet address and which business it belongs to** (operational).
- **Wallet sign-in:** the address and the time. No email, no name.

## 3. What stays with each agent (encrypted at rest, key from `AGENT_STORE_KEY`)
- **Buyer:** hurdle, liquidity floor, caps, human-approval threshold (from `agent/.env`, the owner's own config), the payment calendar (an encrypted file managed through the buyer
  agent's own routes), and the private preimages of every decision.
- **Supplier:** cost of waiting, ceiling, start rate and step, and the private preimages of its decisions.
- **Policy records**: each version of the parameters with its secret salt.
- AES-256-GCM, a fresh nonce per record. Losing the key means those private records cannot be read; the public log and the chain are unaffected.
- Older plaintext files (written before this change) are still readable but are **not rewritten**. Move `.agent-data*/` aside when you rotate, as `docs/SETUP.md` 7c says.

## 4. What is public on Arc whatever we do
Invoice id, supplier and buyer addresses, token, amount, due date, reference hash, who approved, the rate and net paid, the fee, and the decision hash. Anyone can read these on the
explorer. Only private policy numbers and the payment calendar stay private; the salted commitments let an owner prove their policy later without publishing it.

## 5. Tests that hold this line
- `backend/test/pipeline.test.ts`: after a real run, **every row of every table** in the shared store is dumped as text and must contain no payroll amount, reserve, balance, or
  the words hurdle, liquidity floor or cost of waiting.
- `backend/test/agent-read.test.ts` and `auth.test.ts`: `/api/policy`, `/api/prefs`, `/api/obligations`, `/api/agent/obligations` answer 404.
- `backend/test/log-policy.test.ts`: a decision snapshot containing a private policy key is refused.
- `agent/test/vault.test.ts`: the payment calendar, policy file and decision preimages are unreadable on disk, readable with the key, refused with a wrong key, and an undeclared
  calendar is "unavailable" and not "empty".
- `backend/test/chain.test.ts`: wipe the chain cache, re-index from the chain, and stats, invoices, both ledgers, the CSV and the Beancount export come back identical.

# Spec compliance: agents and the idea, against `docs/spec/CLAUDE.pdf` and the Tameion brief

Checked 6 Oct 2026 by reading `agent/src` against spec sections 3.2 to 3.4, 8.1 to 8.7 and 14, and by running the agent tests
(77 pass). Nothing here was run against a real Circle login or a deployed contract, so "built" means "written and tested
locally", never "proven on Arc". Statuses: **Done**, **Fixed today**, **Partial**, **Not built**.

## Flow (spec 3.2)

| Step | Status | Evidence |
|---|---|---|
| 1 to 3 sign, register, approve | Done (contract, backend relayer, UI) | `contract/`, `backend/src/relayer.ts`; contract tests not run in this session |
| 4 supplier agent builds the ask and sends rung 1 | Done | `SupplierAgent.start`, signed `OfferMsg` |
| 5 buyer evaluates eligibility, hurdle, **liquidity floor, obligations**, reputation | **Fixed today** (floor and obligations were missing) | `BuyerAgent.fitsCash` + `fitsCashPath`; reputation flags only from the model-and-code path |
| 6 supplier climbs a short ladder on reject | Done | `buildLadder` (max 6 rungs), stops on DISPUTED, NOT_ELIGIBLE, REPUTATION_FLAG, NEEDS_HUMAN_APPROVAL |
| 7 accept: buyer wallet calls `settleEarly(id, offer, sig, decisionHash)` | Done | `BuyerAgent.settle`, idempotency key `settle:<id>:<nonce>` |
| 8 ERC-8004 feedback by the counterparty | Not built (Tier 2) | listed in `docs/NEXT_STEPS.md` |
| 9 ledger rows, hash-chained log, `/stats` | Done | ledger and stats from chain events; the log is chained, signed, persisted and verified by the API (`/api/log/verify`) |

## Agentic behaviour (spec 3.4, 8.2, 8.3)

| Requirement | Status | Notes |
|---|---|---|
| Two independent processes with private information | Done | separate runners, own wallet adapters; the hurdle is never on the wire (test: "never puts the hurdle on the wire") |
| Zero case: price can clear at 0% | Done | ladder starts at 0; test "zero case" passes with hurdle 0 |
| Supplier: accelerate / wait / partial; clamp to bounds | Done (partial hands to a person; Tier 3) | `supplierProposalSchema` strict; rates clamped to `maxRate(prefs)` |
| Adaptive start from past deals (p25 of at least 3) | Partial | maths done and tested; the runner passes an empty history, so a real run always starts at the configured rate. Needs the backend ledger wired in |
| Supplier uses cash needs and buyer reputation as inputs | Not built | only prefs, history and invoice are in the snapshot |
| Buyer allocator: exact selection, cash-path check, greedy comparison, explanation | Done | `allocate`, brute force up to 20 invoices; tie-breaks per spec |
| Buyer settles per offer without the allocator | **Fixed today** | each accepted offer must fit the cash path (`fitsCashPath`) and the daily cap, using the real USDC balance |
| Escalation above `human_above` to `/buyer/approvals` | Done | `NEEDS_HUMAN_APPROVAL`, `needsApproval` map |
| Model proposes, code decides | Done | no model output reaches a signer or a contract call; schemas are strict |

## Safety rules (spec 8.5)

| # | Rule | Status |
|---|---|---|
| 1 | Untrusted text never in a prompt | Done: snapshots hold numbers and opaque ids; test checks a hostile description never reaches the model |
| 2 | Numbers from signed fields only | Done |
| 3 | zod-validate every model output, check evidence refs | Done (supplier refs checked; buyer flags confirmed by code against its own records) |
| 4 | No model output reaches a signer | Done |
| 5 | Bounds enforced on chain | Contract (40 tests, not run today) |
| 6 | Fail closed on model failure | Done: retry once, then needs_approval `MODEL_UNAVAILABLE`; **treasury unreadable now also fails closed** (`TREASURY_UNAVAILABLE`) |
| 7 | Prompt-injection test | Done |
| 8 | Peer messages are untrusted | Done: strict schemas, sender and signature verified before any decision |
| 9 | MCP write tools need `confirm` | N/A: MCP server not built (Tier 2) |
| 10 | Bids and claim tokens | Claim links built and tested in `backend/` (needs Anvil to run); bids are Tier 3 |

## Protocol (spec 8.6)

Signed offer, accept and reject messages over `POST /negotiate`; reject carries a reason code only; verified against the known
agent wallet. **Fixed today:** the endpoint is now idempotent. A retried offer (a timeout, a sender restart) gets the same
answer and settles once; before, a retry of an accepted offer came back as a reject. A different message that reuses a spent
nonce is still rejected.

## Failure modes judges named (spec 3.13)

| Failure | Status |
|---|---|
| Wrong vendor | Done: only the invoice's own supplier may offer; payout address is fixed on chain |
| Fake invoice | Done: invoice must be registered and approved on chain before any offer is considered |
| Retry pays twice | Done: deterministic idempotency key, on-chain single-use nonce, idempotent `/negotiate` |

## Fixed in this review

1. The buyer accepted any offer that cleared the hurdle without checking the liquidity floor, obligations or daily cap. It now
   checks the cash path against the real balance first, and rejects with `LIQUIDITY_FLOOR` or waits for a person.
2. A retried offer was answered with a reject after it had already settled. Replies are now cached per (invoice, rung, nonce).
3. Control routes (`/accept`, `/plan`, `/plan/execute`, `/policy`, `/decisions`, `/pause`, `/start`) answered any caller once an
   agent was exposed beyond localhost, and `/policy` returns the private hurdle. They now answer this machine, or a remote caller
   with `AGENT_CONTROL_TOKEN`; only `/health` and `/negotiate` are open. Behind a reverse proxy every caller looks local, so
   keep the control routes off the proxy.
4. 4 new tests (liquidity, fail closed on treasury, idempotent retry, nonce reuse) and 1 for the control rule: 77 agent tests.

## Still open (agents)

- **Decision log (was in memory only): fixed on 6 Oct.** Each agent now keeps its chain in a file that survives a restart (a
  tampered file stops the agent at start), signs every entry with its wallet (EIP-712 `DecisionAttestation`), and delivers it to
  `POST /api/log/ingest`. The API accepts an entry only from a configured agent wallet (`AGENT_WALLETS`), and only after it
  recomputes the hash, checks the signature and checks that the entry continues that agent's chain (a gap or a fork is refused).
  `/api/log/verify` recomputes every chain and every signature from the stored rows; `/api/log` lists entries with the settlement
  transaction that carries the same hash. Tested: 3 agent tests, 6 API tests. Not yet run with a real Circle wallet: a contract
  wallet's signature is checked through the chain RPC.
- **The buyer's obligation calendar is now read from the backend** (signed read, 14 Oct); an unreadable calendar fails closed. Supplier history (`pastAcceptedBps`) is still not read in a real run: the supplier runner passes an empty list.
- ERC-8004 identity and feedback, MCP server, A2A cards, compliance screening: Tier 2, not built.
- Circle Agent Wallet adapter has never run against a real login (Appendix A items 5 to 8). First real run will likely need fixes.
- Contract tests and the two Anvil backend suites **were run on 14 Oct and pass** (Foundry is installed on this machine).

## SRS v1.0 layer (14 Oct 2026): credit, ranges, policy versions and audit

Requirement-by-requirement status is in `docs/SRS_GAP_PLAN.md`; how it works is in `docs/SRS_IMPLEMENTATION_SPEC.md`. Summary against the safety rules above:

| Rule | How the new layer keeps it |
|---|---|
| Model proposes, code decides | The buyer's decision is one pure function (`decideBuyerOffer`) and the ladder another (`planLadder`). The model never feeds either; its numbers are clamped into the supplier's own bounds. No model output reaches a signer or a contract call |
| Untrusted text never in a prompt | Unchanged. The exposure feed and the calendar carry numbers, hashes and enums only, and the calendar's free-text label is not sent to the agent |
| Fail closed | An unreadable balance, calendar, credit policy or credit history gives `needs_approval` (`TREASURY_UNAVAILABLE` or `EVIDENCE_UNAVAILABLE`) and nothing is signed. Unknown counterparties get a starting limit of 0 |
| Peer messages are untrusted | The reject on the wire still carries one code only; no limit, hurdle or floor can be inferred from it beyond the fact that the check failed |
| Private stays private | Hurdle, reserve, caps and limits are never in the public log. The store and the API both refuse a private key name in a snapshot or proposal, and the public entry carries only a salted commitment to the inputs |
| Real data only | History comes from indexed chain events with a transaction hash and log index; with none, the page says so. Declared obligations are labelled declared |

**Tested:** 168 agent tests, 64 backend tests (including `pipeline.test.ts`, which runs both agents against the real API in one process), 45 frontend tests, both real-browser end-to-end suites.
**Not tested on Arc:** nothing in this layer has run against a deployed contract or a real Circle wallet.
**Known limits:** the supplier agent does not gate on credit (it only reports it); `/plan` (the allocator) is not exposure-aware, but `/plan/execute` skips any payment the credit limit forbids; the supplier's adaptive start from past deals is still unwired.

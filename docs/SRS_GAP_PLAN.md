# SRS v1.0 ("Autonomous Commercial Credit and Settlement"): audit and plan

Written 14 Oct 2026, **updated the same day after the build**. The SRS is the product framing the team pasted on 14 Oct (Part 1 idea,
Part 2 requirements, priority list in section 15). It is a layer on top of the existing build, not a rewrite. Where it conflicts with
`docs/spec/CLAUDE.pdf`, the conflicts are listed in section 3 and the choice is recorded in `docs/DECISIONS.md`. Everything marked
**VERIFY** is unconfirmed. How each item is built, and where the build differs from the plan, is in `docs/SRS_IMPLEMENTATION_SPEC.md`.

## 1. Audit: SRS requirement against the repo

Statuses: **Done** (written and tested locally), **Partial**, **Not built**, **Not proven** (built, never run on Arc).
"Before" is the audit made at the start of the day; "Now" is the state after the build.

| SRS | Requirement | Before | Now | Where |
|---|---|---|---|---|
| FR-01 | Business onboarding, wallet, role, backend auth | Done | Done | Google + wallet sign-in, side choice; `e2e:accounts` |
| FR-02 | Invoice create, unique id, six-decimal bigint, lifecycle, no double pay | Done | Done | `InvoiceBook` (40 tests), backend read model |
| FR-03 | Supplier agent: floor from economic rules, signed offers, reason codes | Partial | **Done** (no urgency input, by decision) | `supplierFloor`, `planLadder`, fixed reason text; the floor is shown to the owner on the invoice page |
| FR-04 | Buyer agent: balance, reserved obligations, max affordable, verified vs declared | Partial | **Done** | `buyerCeiling`, `decideBuyerOffer`; the real calendar is read by signed request; every obligation is labelled `declared` |
| FR-05 | Credit and exposure engine, policy-defined limit per relationship | Not built | **Done** (enforced on the buyer side) | `core/exposure.ts`, versioned owner policy, `GET /api/exposure`; supplier side is shown, not gated (see the spec) |
| FR-06 | Bounded signed offers, policy version, expiry, nonce, attempt limit | Partial | **Done**, without a contract change | The policy version rides in the log entry whose hash is the on-chain `decisionHash` |
| FR-07 | Contract validates identity, parties, signature, expiry, replay, amount, no duplicate | Done | Done | 40 contract tests, run 14 Oct. Exposure is deliberately **not** on chain |
| FR-08 | Real USDC settlement, states proposed to settled, tx hash | Not proven | **Not proven on Arc.** State logic done (`payState`) | A real settlement is proven on a local Anvil chain by `e2e:local`; the Arc deploy and the Circle wallets are the owner's |
| FR-09 | History from verified chain events only, no double count | Partial | **Done** | Each settlement counted once by invoice, only with a transaction hash and log index; disputes and overdue handled apart |
| FR-10 | Audit trace: inputs, policy version, offers, reason codes, tx hash | Partial | **Done** | Every entry carries `policyVersion` and salted commitments; the owner can replay any decision (`audit-decision`) |
| NFR-01 | Integer minor units | Done | Done | bigint throughout; the one percent field is parsed to basis points with integers |
| NFR-04 | Same inputs and policy version give the same decision | Partial | **Done** for every code-made decision | `decideBuyerOffer` and `planLadder` are pure; replay tests |
| NFR-05, 06 | Unverified labelled, on-chain vs off-chain shown apart | Partial | **Done** | `on-chain` / `policy` / `declared` / `unavailable` tags; unreadable inputs fail closed |
| NFR-08 | RPC failure, pending, failed never shown as success | Partial | **Partly done** | Only the chain can say "settled"; a wallet failure after an accept shows "failed". Not yet exercised in a browser |
| Section 10 | Four views | Partial | **Done** | Treasury card, credit basis, negotiation trace with range bar, settlement and history; the agent log shows policy versions |
| Acceptance | 10-item checklist | 0 of 10 | see below | |

### Acceptance checklist, as proven today

| # | Item | Proven by | State |
|---|---|---|---|
| 1 | Wallet and business authorization | `e2e:accounts` (real browser, real backend) | Proven locally |
| 2 | Invoice integrity | contract tests (`test_secondSettle_reverts` and others) | Proven locally |
| 3 | Independent agent decisions | `decision.test.ts` (reserve, calendar, hurdle, cap), `negotiation.test.ts` (cash 100,000 vs 5,100), `pipeline.test.ts` (payroll through the real API) | Proven locally |
| 4 | Negotiation correctness | `NO_OVERLAP` and `BUYER_CANNOT_PAY` tests; the ladder always reaches the ceiling; no settlement call when ranges do not meet | Proven locally |
| 5 | Credit exposure | `exposure.test.ts`, `negotiation.test.ts` (`EXPOSURE_LIMIT` although cash is ample), `pipeline.test.ts` | Proven locally |
| 6 | Signature validation | contract tests (wrong, expired, replayed) and `protocol.test.ts` | Proven locally |
| 7 | Actual settlement | needs the Arc deploy and real wallets | **Not proven** (a real settlement on a local chain is) |
| 8 | History update | `backend/test/exposure.test.ts` (indexed events to history), `pipeline.test.ts` | Proven locally on indexed events; on Arc needs the deploy |
| 9 | Failure handling | `paystate` tests: a pending or failed attempt is never "settled" | State logic proven; not yet exercised in a browser |
| 10 | Reproducibility | audit tests: replay gives the same decision; tampering is caught | Proven locally |

## 2. Plan, in the SRS dependency order

1. **Transaction path (blocking, needs the owner).** Deploy `InvoiceBook`, fund and log in both agent wallets, run one real
   settlement with `e2e-testnet`, fix whatever the real Circle CLI output breaks. Nothing else can be called proven on Arc before this. **Open.**
2. **Constraint-based decisions.** **Done** (`core/decision.ts`, `core/decide.ts`, reason codes, tests).
3. **Minimal credit layer.** **Done** (`core/exposure.ts`, owner policy, history feed, buyer enforcement).
4. **Audit trail and demo.** **Done** for the trail and the views. The demo itself (SRS section 14) still has to be run on Arc and recorded.

## 3. Where the SRS and the existing spec disagree (and what was done)

| Point | SRS | Existing spec / code | Choice |
|---|---|---|---|
| Fixed ladder | "rather than a fixed discount ladder" | Supplier climbs a short ladder (max 6 rungs) from 0% | Kept as the **message protocol** (bounded, signed, expiring offers). The supplier never signs above its computed ceiling, the buyer never accepts below its computed floor, and the last rung is always the ceiling. If the ranges do not meet the agents stop with `NO_OVERLAP` |
| Credit on chain | Contract validates "applicable limits" | Contract checks the supplier's signed terms, not counterparty exposure | Exposure is enforced **off chain in each agent** (an agent never signs a payment that breaks its own limit). No on-chain exposure oracle: the contract must not trust off-chain financial claims, which is the SRS's own rule |
| Lending | Out of scope | Same | Agreed: no loans, no pool, no token |
| Revenue | Hypotheses only | Spec has `FEE_BPS` | The fee is kept; revenue is described as a hypothesis |
| Real data | No seeded or demo data | Same rule (spec section 0) | Agreed. The history feedback loop shows only real indexed settlements; with none it says so |

## 4. What is not in the repo and only the owner can supply

The account steps are in `docs/SETUP.md`. In short: the deployer key and faucet funds, two Circle logins, an Anthropic key, a Postgres
URL, a Google client id, one real counterparty with an invoice, and the Arc RPC URL confirmed from an authoritative source. After the
agents run, each owner also makes a link code on the Credit limits page and starts their agent once with it. None of these may be
committed (`.env` files stay local).

## 5. Detailed spec

`docs/SRS_IMPLEMENTATION_SPEC.md` holds the design of the four work items, the tests, and (at the top) what was built and where it differs.
It also records finding F-0 from this review: the public `/api/log` returned each decision's snapshot, and the supplier agent's snapshot
contained its private cost of waiting and maximum rate. That is fixed and guarded against in the agent and in the API.

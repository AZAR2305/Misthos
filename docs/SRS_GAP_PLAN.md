# SRS v1.0 ("Autonomous Commercial Credit and Settlement"): audit and plan

Written 14 Oct 2026. The SRS is the product framing the team pasted on 14 Oct (Part 1 idea, Part 2 requirements, priority list in
section 15). It is a proposal on top of the existing build, not a rewrite. Where it conflicts with `docs/spec/CLAUDE.pdf`, the
conflicts are listed in section 3 and the choice is recorded in `docs/DECISIONS.md`. Everything marked **VERIFY** is unconfirmed.

## 1. Audit: SRS requirement against the repo

Statuses: **Done** (written and tested locally), **Partial**, **Not built**, **Not proven** (built, never run on Arc).

| SRS | Requirement | Status | Where / gap |
|---|---|---|---|
| FR-01 | Business onboarding, wallet, role, backend auth | Done | Google + wallet sign-in, side choice in `backend/` and `frontend/`; `e2e:accounts` |
| FR-02 | Invoice create, unique id, six-decimal bigint, lifecycle, no double pay | Done | `InvoiceBook` (40 tests pass, run 14 Oct), backend read model |
| FR-03 | Supplier agent: floor from economic rules, signed offers, reason codes | Partial | Floor today is `cost of waiting APR` and `max rate` (`SUPPLIER_*` env). No urgency or cash-need input. Reason codes exist for rejects |
| FR-04 | Buyer agent: balance, reserved obligations, max affordable, verified vs declared | Partial | `fitsCashPath`, floor, daily cap done. Obligation calendar is empty in a real run; verified/declared label missing |
| FR-05 | Credit and exposure engine, policy-defined limit per relationship | **Not built** | No exposure code in `agent/`, `backend/`, `contract/` or `frontend/` |
| FR-06 | Bounded signed offers, policy version, expiry, nonce, attempt limit | Partial | Ladder max 6 rungs, expiry, nonce done. **Policy version is not in the signed offer** |
| FR-07 | Contract validates identity, parties, signature, expiry, replay, amount, no duplicate | Done | Contract tests cover each. **No exposure check on chain** (see section 3) |
| FR-08 | Real USDC settlement, states proposed to settled, tx hash | Not proven | Contract is **not deployed**; the adapter has never run against a real Circle login |
| FR-09 | History from verified chain events only, no double count | Partial | Ledger and `/stats` come from chain events. Not yet fed to any credit decision; disputes and declarations not labelled separately |
| FR-10 | Audit trace: inputs, policy version, offers, reason codes, tx hash | Partial | Signed hash-chained decision log, `/api/log/verify`, proof column. Policy version and input verification status are missing from entries |
| NFR-01 | Integer minor units | Done | bigint throughout |
| NFR-04 | Same inputs and policy version give the same decision | Partial | Code paths are deterministic; the model layer is not, and the policy version is not recorded, so a replay cannot prove it |
| NFR-05, 06 | Unverified labelled, on-chain vs off-chain shown apart | Partial | "unavailable" rule is applied; no verified/declared tag on obligations |
| NFR-08 | RPC failure, pending, failed never shown as success | Partial | Outbox and idempotent jobs done; the UI state set (proposed, accepted, submitted, confirmed, failed, settled) needs an audit |
| Section 10 | Four views (treasury, invoice + credit, negotiation trace, settlement + history) | Partial | Treasury, invoices, agent log, ledger exist. No credit-basis panel. No reservation-price range in the trace |
| Acceptance | 10-item checklist | 0 of 10 proven on Arc | Items 1, 2, 4, 6, 10 are covered by local tests; 3, 5, 8 need new code; 7 and 9 need the deploy |

## 2. Plan, in the SRS dependency order

1. **Transaction path (blocking, needs the owner).** Deploy `InvoiceBook`, fund and log in both agent wallets, run one real
   settlement with `e2e-testnet`, fix whatever the real Circle CLI output breaks. Nothing else can be called proven before this.
2. **Constraint-based decisions.** Make the supplier floor explicit (`S_min` from face value, days to due, discount rate,
   urgency); make the buyer's `B_max = min(max(0, W - R - O), B_econ)` explicit with fee included; feed the real obligation
   calendar from `/api/obligations`; add a structured reason code on every accept, counter and reject; tests that changing
   `R`, `O` or `S_min` changes the outcome and that non-overlapping ranges end with no deal.
3. **Minimal credit layer.** A pure function `allowedExposure(policy, history)` in `agent/` using only chain-verified settled
   invoices, outstanding unpaid exposure per counterparty and explicit limits; unknown history gives the conservative default
   and is never treated as positive. The buyer and supplier both check `E_new + E_outstanding <= C_allowed` before signing.
   History comes from the indexer's settlement events only; each event counted once by (invoice, tx, log index).
4. **Audit trail and demo.** Add `policyVersion` and the evidence references to each decision-log entry and to the signed offer;
   a credit-basis panel on the invoice view; a reservation-price range on the negotiation trace; verified/declared labels;
   run the whole suite and record the demo from section 14 of the SRS.

Cut line if time runs out (final is Fri 16 Oct, 6 PM IST): steps 1 and 2 are required; step 3 ships as an off-chain policy
check only and step 4 ships as the log fields without new panels. Anything not finished is labelled a planned extension in the UI
and the README, as the SRS itself requires.

## 3. Where the SRS and the existing spec disagree (and what to do)

| Point | SRS | Existing spec / code | Choice |
|---|---|---|---|
| Fixed ladder | "rather than a fixed discount ladder" | Supplier climbs a short ladder (max 6 rungs) from 0% | Keep the ladder as the **message protocol** (bounded, signed, expiring offers). Change what sets each rung: it must never go below the supplier's computed `S_min`, and the buyer never signs above `B_max`. If `S_min > B_max` the agents stop with `NO_OVERLAP` |
| Credit on chain | Contract validates "applicable limits" | Contract checks the supplier's signed terms, not counterparty exposure | Enforce exposure **off chain in each agent** (an agent never signs an offer that breaks its own limit). Do not add an on-chain exposure oracle: the contract must not trust off-chain financial claims, which is the SRS's own rule |
| Lending | Out of scope | Same | Agree: no loans, no pool, no token |
| Revenue | Hypotheses only | Spec has `FEE_BPS` | Keep the fee; describe revenue as a hypothesis |
| Real data | No seeded or demo data | Same rule (spec section 0) | Agree. The history feedback loop is shown only if real settlements exist; otherwise a labelled planned extension |

## 4. What is not in the repo and only the owner can supply

See the list given in chat on 14 Oct and the account steps in `docs/SETUP.md`. In short: the deployer key and faucet funds, two
Circle logins, an Anthropic key, a Postgres URL, a Google client id, one real counterparty with an invoice, and the Arc RPC URL
confirmed from an authoritative source. None of these may be committed (`.env` files stay local).

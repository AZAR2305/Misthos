# SRS implementation spec: the four work items, in detail

Written 14 Oct 2026, from a read of `agent/src`, `contract/src/InvoiceBook.sol`, `backend/src/api.ts` and `frontend/src`.
Companion to `docs/SRS_GAP_PLAN.md` (audit and order of work). **Nothing in this file is implemented yet.** Every file name, type
and function named below exists today unless it is marked *new*. Statements that need a real run to confirm are marked `VERIFY:`.
Worked numbers are hand-computed from the repo's own formulas; the tests in section 8 must reproduce them exactly, and if a test
disagrees, the test result wins and this file is corrected.

Order of work: **F-0** (privacy fix) first, then **A**, **B**, **C**, **D**, then the tests in section 8.

---

## 0. What the code does today (the facts the design rests on)

| Fact | Where |
|---|---|
| Price of an offer: `discount = floor(F * rateBps * secondsEarly / (10_000 * 31_536_000))`, `net = F - discount`, `fee = floor(discount * feeBps / 10_000)`, `outflow = net + fee`. The supplier receives `net`; the buyer's wallet pays `outflow`. Same formula as the contract | `core/pricing.ts` |
| Higher rate means a lower price. So the **supplier** wants a *low* rate and the **buyer** wants a *high* rate. The SRS inequality `S_min <= B_max` becomes a *rate interval* in this code | `core/pricing.ts` |
| Supplier ceiling: `maxRate = max(0, min(prefs.maxRateBps, prefs.costOfWaitingAprBps - 200, 5000))`. The ladder runs from the start rate up to that ceiling in at most 6 rungs | `core/policy.ts` (`maxRate`, `buildLadder`), `core/ladder.ts` |
| Buyer evaluation order: disputed, not approved, already due, expired, reputation flag, `offerRate < hurdle`, discount too large, per-invoice cap, human-above, then the liquidity cash path and daily cap | `core/policy.ts` (`evaluateOffer`), `agents/buyer.ts` (`fitsCash`, `fitsCashPath`) |
| Reason codes today: `BELOW_HURDLE, LIQUIDITY_FLOOR, NOT_ELIGIBLE, NEEDS_HUMAN_APPROVAL, EXPIRED, DISPUTED, REPUTATION_FLAG`. A reject carries a code only | `core/policy.ts`, `protocol/schemas.ts` |
| The signed on-chain offer is `EarlyPayOffer(bytes32 invoiceId, uint16 rateBps, uint64 expiry, uint256 nonce)`. `settleEarly(id, offer, sig, decisionHash)` takes a `decisionHash` and the `EarlySettled` event emits it | `core/eip712.ts`, `InvoiceBook.sol` lines 112 and 255 |
| The decision log is hash-chained: `hash = keccak256(canonicalJson({prev_hash, actor, snapshot, proposal, outcome, reason}))`, signed by the agent wallet, delivered to `POST /api/log/ingest`, and **returned in full, including `snapshot`, by the public `GET /api/log`** | `core/hash.ts`, `agents/store.ts`, `backend/src/api.ts:324` |
| Contract states: `None, Registered, Approved, SettledEarly, SettledOnDue, Disputed`. Settlement events: `EarlySettled`, `SettledOnDue`, `BatchSettled`. Ledger and `/stats` are built from indexed chain events | `InvoiceBook.sol`, `backend/src` |
| The buyer's obligation calendar exists in the backend (`GET/POST /api/obligations`, table `obligations`, column `kind`) but the buyer runner passes an empty list | `backend/src/api.ts:471`, `docs/SPEC_COMPLIANCE.md` |

---

## F-0. Fix before anything else: the public log leaks private supplier settings

`SupplierAgent.start` builds `snapshot = { invoice, prefs: this.d.prefs, history, allowedRefs }` and logs it. The snapshot is part
of the hashed entry, so the backend must store it to re-verify the hash, and `GET /api/log` returns it to anyone. That publishes
`costOfWaitingAprBps` and `maxRateBps`, which spec 8.2 and the file header call private, and it hands the buyer's side the
supplier's reservation price. The buyer's current entries log only the rung and rate, so the buyer side is fine today.

**Rule for all new work: nothing in a snapshot or proposal may be a private policy value.** Public log content is limited to the
public items in the table in section C.3. Private values are committed by a salted hash, not stored.

Fix: log `{ face, secondsEarly, policyVersion, policyCommitment, inputsCommitment, pastAcceptedCount }` instead of `prefs`; keep
the real `prefs` only in the model call, which is not logged. Add a test that fails if a log entry's canonical JSON contains any
key in a private-keys list (`costOfWaitingAprBps`, `maxRateBps`, `hurdleAprBps`, `liquidityFloor`, `perInvoiceCap`, `dailyCap`,
`humanAbove`, and the new exposure limits). Existing logs written before the fix stay as they are (they are hash-chained and
cannot be edited); note in `docs/DECISIONS.md` that entries before this commit contain the supplier prefs.

---

## A. Supplier floor and buyer ceiling, as explicit tested functions

### A.1 The mapping (SRS 6.1 to 6.3 onto this code)

Per invoice with face `F` (minor units, bigint), `t` seconds to the due date, fee rate `feeBps`:

- `P(r)`: the net the supplier receives at rate `r` bps = `F - discountOf(F, r, t)`. Strictly decreasing in `r`.
- `Out(r)`: what the buyer pays = `P(r) + feeOf(discountOf(F, r, t), feeBps)`. Also decreasing in `r`.

**Supplier floor.** `S_min = P(r_sup)` where `r_sup = maxRate(prefs)` is the highest rate the supplier will sign. The SRS rule
"accept only if `P >= S_min`" is the same as "sign only a rate `<= r_sup`". The supplier never signs above `r_sup`; this is
already how `maxRate` clamps the ladder, so the new function exposes it as an amount and a reason code instead of a bare number.

**Buyer ceiling.** The buyer's largest affordable payment is `B_max = min(L_available, B_econ)` where
- `L_available = max(0, W - R - O_due)`; `W` the real USDC balance, `R` the liquidity floor, `O_due` obligations due before the
  invoice's due date and **not already inside `R`** (the SRS asks that obligations are not double-counted; rule below);
- `B_econ = Out(r_hurdle)`: the payment at which the buyer earns exactly its hurdle. A higher hurdle means a lower `B_econ`.

Because `Out` is decreasing, "`Out(r) <= B_max`" is the same as "`r >= r_buy`" where `r_buy` is the **smallest integer rate
whose `Out(r) <= B_max`**. With the hurdle folded in, `r_buy = max(r_hurdle, r_liquidity)` where `r_liquidity` is the smallest `r`
with `Out(r) <= L_available`. Found by binary search over `0..5000` (monotone), integer arithmetic only.

**Deal discovery (SRS 6.3).** The feasible interval is `[r_buy, r_sup]`. A deal exists iff `r_buy <= r_sup`
(equivalently `S_min <= B_max` in money terms). If not, the result is `NO_OVERLAP` and the agents stop; no deal is fabricated.

**Double counting rule for `O`.** `R` is a standing floor that must remain after every payment. `O_due` is the sum of obligations
whose `dueSec` is on or before the invoice's due date and which are flagged `declaredInReserve = false`. Obligations the owner
marks as already covered by `R` are shown but not subtracted again. (Existing `fitsCashPath` already walks the calendar day by day;
the new function must agree with it, and a test asserts that for any input where the new `L_available` is positive, `fitsCashPath`
and the new `Out(r) <= L_available` check give the same answer on a single-invoice plan. `VERIFY:` the two cases where they could
differ: obligations due after the invoice due date, and the daily cap.)

**Verified versus declared.** Every term carries a status: `W` is `onchain` (read from the USDC balance); `R`, `feeBps` and caps are
`policy` (set by the owner); `O` is `declared` unless backed by an on-chain or signed record. `O.kind` in the backend already
exists; `VERIFY:` its allowed values before wiring. Declared values may reduce what the buyer pays (they only shrink `L`), they may
never increase it. Unavailable values (balance unreadable, obligations unreadable) give `TREASURY_UNAVAILABLE`, never a default.

### A.2 New code (*new* unless stated)

`agent/src/core/decision.ts`:

```ts
export type Provenance = "onchain" | "policy" | "declared" | "unavailable";

export interface SupplierFloorInput { face: bigint; secondsEarly: bigint; prefs: SupplierPrefs; feeBps: number }
export interface SupplierFloor {
  maxRateBps: number;     // r_sup
  floorNet: bigint;       // S_min = P(r_sup)
  floorAprBps: number;    // for display only
}
export function supplierFloor(i: SupplierFloorInput): SupplierFloor

export interface BuyerCeilingInput {
  face: bigint; secondsEarly: bigint; feeBps: number;
  cash: bigint; cashProvenance: Provenance;
  policy: BuyerPolicy;                       // R = liquidityFloor, hurdle, caps
  obligations: readonly (Obligation & { declaredInReserve: boolean; provenance: Provenance })[];
  spentToday: bigint;
}
export interface BuyerCeiling {
  available: bigint;      // L_available
  econMax: bigint;        // B_econ = Out(r_hurdle)
  maxPay: bigint;         // B_max
  minRateBps: number | null;  // r_buy, null when even 5000 bps does not fit
  inputs: Array<{ ref: "balance" | "reserve" | "obligations" | "caps"; provenance: Provenance }>;
}
export function buyerCeiling(i: BuyerCeilingInput): BuyerCeiling

export type DealRange =
  | { kind: "overlap"; minRateBps: number; maxRateBps: number }
  | { kind: "none"; reason: "NO_OVERLAP" | "TREASURY_UNAVAILABLE" | "BUYER_CANNOT_PAY" };
export function dealRange(s: SupplierFloor, b: BuyerCeiling): DealRange
```

Changes to existing code:
- `ladder.ts` / `buildLadder`: rungs below `r_buy` are skipped only on the **buyer** side (the buyer rejects them); the supplier never
  learns `r_buy`. So the supplier ladder is unchanged. What changes is that the buyer's reject for a too-low rate returns
  `BELOW_HURDLE` or `LIQUIDITY_FLOOR` according to whether `r_hurdle` or `r_liquidity` is the binding term. Today a liquidity
  failure is found after the hurdle test; the new order must give the same codes as today in every case already tested
  (`agent/test/negotiation.test.ts`), plus the new `NO_OVERLAP` for the case where the supplier's ladder is exhausted.
- `BuyerAgent.fitsCash` calls `buyerCeiling` and records its output (public parts only) in the log.
- `SupplierAgent.start`: before building the ladder, compute `supplierFloor`; if `maxRateBps` is `0` and the buyer later rejects
  rung 0, the result is `hold_to_due` with reason code `NO_OVERLAP` (today: generic "Every rung was rejected").
- `runners/buyer.ts`: replace the empty obligation list with `GET /api/obligations` (`BACKEND_URL`). If it fails: `TREASURY_UNAVAILABLE`,
  fail closed (the existing rule).

### A.3 Reason codes (SRS FR-03, FR-04, FR-06: "structured reason codes")

Add to `REASON_CODES` (so they can ride in the strict reject schema and in the log):
`NO_OVERLAP`, `EXPOSURE_LIMIT`, `TREASURY_UNAVAILABLE`, `BUYER_CANNOT_PAY`. Each code has a fixed one-line meaning in a table in
`core/policy.ts` (*new* `REASON_TEXT`) used by the UI; the UI never builds text from a number. Adding to the enum changes
`reasonRef` hashes only for the new codes, so existing signatures stay valid. A reject still carries no hurdle, floor or limit value.

### A.4 Worked example (becomes the first test fixtures)

`F = 10_000 USDC = 10_000_000_000`, due in 30 days (`t = 2_592_000`), `feeBps = 1000`. One basis point of rate costs
`F*t/(10_000*31_536_000) = 82_191.78` minor units of discount.

| Rate | discount | net (supplier gets) | fee | outflow (buyer pays) |
|---|---|---|---|---|
| 2000 bps (20% APR) | 164_383_561 | 9_835_616_439 | 16_438_356 | 9_852_054_795 |
| 1352 bps | 111_123_287 | 9_888_876_713 | 11_112_328 | 9_899_989_041 |
| 1351 bps | 111_041_095 | 9_888_958_905 | 11_104_109 | 9_900_063_014 |

Supplier: cost of waiting 2200, max rate 5000, so `r_sup = min(5000, 2000, 5000) = 2000`, `S_min = 9_835_616_439`.
Buyer: `W = 10_200 USDC`, `R = 300 USDC`, `O_due = 0`, hurdle 600 bps. `L_available = 9_900 USDC = 9_900_000_000`.
`r_liquidity = 1352` (1351 gives 9_900_063_014 > 9_900_000_000), so `r_buy = max(600, 1352) = 1352`.
Feasible interval `[1352, 2000]`: **deal**. The supplier ladder (`ceiling 2000`, step widened to 400 because 11 rungs exceed 6) is
`0, 400, 800, 1200, 1600, 2000`; rungs 0 to 1200 are rejected `LIQUIDITY_FLOOR`, rung 1600 is accepted.

Policy change for the demo (SRS demo step 5): raise `R` to 1_000 USDC. `L_available = 9_200 USDC`; even at 2000 bps the outflow is
9_852_054_795 > 9_200_000_000, so `r_buy = null`, `dealRange = none / NO_OVERLAP`, every rung is rejected, no transaction. Lower `R`
back to 300 and the same invoice settles at 1600.

---

## B. Credit and exposure function (SRS FR-05, 6.4)

### B.1 What "exposure" means here (a design decision to confirm)

The protocol negotiates *early payment*, which removes exposure, so the SRS credit rule needs a defined meaning. Proposal, one
pure function with two sides:

| Side | Question | `E_new` | `E_outstanding` (from indexed chain events only) |
|---|---|---|---|
| Supplier | How much unpaid credit am I willing to hold against this buyer? Used when the supplier registers or approves a new invoice and when the agent decides to hold to due | face of the new invoice | sum of `face` of this buyer's invoices in `Approved` that are not settled |
| Buyer | How much will I pay ahead of terms to this supplier at once? Used before the buyer agent accepts a rung | `outflow` of the new early payment | sum of `outflow` of `EarlySettled` payments to this supplier whose due date is still in the future (money paid ahead of terms, past the dispute window) |

Rule: `E_new + E_outstanding <= C_allowed`. If not, the agent returns `EXPOSURE_LIMIT` and signs nothing. This is what produces the
SRS case "has enough USDC but is rejected for additional exposure".

> **Decision for the owner (Open decision 1):** ship the buyer side (it gates a signature in the existing flow and shows in the
> demo) and the supplier side (invoice creation gate), or the buyer side only. Recommendation: both, with the supplier side as a
> warning plus agent skip, not a contract block.

### B.2 Allowed limit (deterministic, explicit)

```
C_allowed = min( maxLimit,
                 newCounterpartyLimit + floor( verifiedSettledVolume * growthBps / 10_000 ) )
```

- `newCounterpartyLimit`: owner-set, per side, default **0**. Unknown counterparties get no credit until the owner sets this. The
  function never invents a positive default. (Unknown must not be positive evidence: SRS 6.4.)
- `verifiedSettledVolume`: sum of `face` of invoices with this counterparty that reached `SettledEarly` or `SettledOnDue` inside
  `lookbackDays`, counted **once per `invoiceId`**, each backed by `{ txHash, logIndex }` from the indexer. An invoice appears once
  even if the indexer re-reads a block or two events mention it.
- `growthBps`: owner-set, default 2000 (a counterparty may be extended 20% of what it has settled in the window). `VERIFY:` the
  owner's numbers; the default is a placeholder to be confirmed, not a recommendation about risk.
- `maxLimit`: owner-set hard ceiling per counterparty, default equal to `newCounterpartyLimit` until set.
- Disputed invoices: excluded from `verifiedSettledVolume` and **not** counted as a default. They are listed as `disputed` evidence and
  shown separately.
- Overdue: an unsettled invoice more than `graceSeconds` (default 86_400, to cover indexing delay) past due stays in
  `E_outstanding` (it is still owed) and is flagged `overdue`. It does **not** reduce `C_allowed` by itself and is not labelled fraud;
  it simply stops contributing to growth. Nothing is permanent: when it settles it counts like any other settled invoice, so the
  limit recovers (SRS section 7).
- Recency: only events inside `lookbackDays` (default 180) count.

### B.3 Code (*new*)

`agent/src/core/exposure.ts`:

```ts
export interface ExposurePolicy {
  version: string;                 // "exp-1"
  newCounterpartyLimit: bigint; maxLimit: bigint; growthBps: number;
  lookbackDays: number; graceSeconds: number;
}
export interface InvoiceEvent {      // from the indexer, one row per terminal or open invoice
  invoiceId: string; state: "approved" | "settled_early" | "settled_on_due" | "disputed";
  face: bigint; outflow?: bigint; dueSec: bigint; settledAtSec?: bigint;
  txHash?: string; logIndex?: number;   // present for settled rows
}
export interface ExposureInput {
  side: "supplier" | "buyer"; nowSec: bigint; newExposure: bigint;
  events: readonly InvoiceEvent[]; policy: ExposurePolicy;
  historyAvailable: boolean;         // false when the indexer could not be read
}
export interface ExposureDecision {
  ok: boolean; reasonCode?: "EXPOSURE_LIMIT" | "TREASURY_UNAVAILABLE";
  allowed: bigint; outstanding: bigint; newExposure: bigint; headroom: bigint;
  evidence: Array<{ ref: string; kind: "onchain" | "declared" | "disputed" | "overdue"; amount: bigint; txHash?: string; logIndex?: number }>;
}
export function evaluateExposure(i: ExposureInput): ExposureDecision
```

Integer arithmetic only. If `historyAvailable` is false the function returns `TREASURY_UNAVAILABLE`-style failure
(`reasonCode: "TREASURY_UNAVAILABLE"` reused as "evidence unavailable"); it never falls back to `newCounterpartyLimit` plus a guess.
`VERIFY:` a separate `EVIDENCE_UNAVAILABLE` code may read better in the UI; decide when writing the UI text.

### B.4 Where it is called

- `BuyerAgent.handleOffer`, after `evaluateOffer` and before `fitsCash`: build `events` from the backend ledger
  (`GET /api/ledger`, chain events only), `newExposure = priced outflow`, call `evaluateExposure({side:"buyer", ...})`.
- `SupplierAgent.start`: supplier side, on `hold_to_due` decisions and from a *new* backend check on invoice creation
  (`POST /api/relay/register` path) that returns the headroom to the UI; the contract is not changed.
- The data source is the indexer's table of chain events (`EarlySettled`, `SettledOnDue`, `InvoiceApproved`, `InvoiceDisputed`,
  `InvoiceRegistered`). A new backend read, `GET /api/exposure?counterparty=0x..&side=buyer` (*new*), returns the `events` array only;
  the agent computes the decision itself, so the backend is never the authority (SRS 4, 11).
- **No contract change.** The contract must not trust off-chain financial claims; the limit is enforced by each agent refusing to sign.

### B.5 Worked example

Buyer policy: `newCounterpartyLimit = 5_000 USDC`, `growthBps = 2000`, `maxLimit = 20_000 USDC`, `lookbackDays = 180`.
History with supplier S: two settled invoices. Invoice 1: face 10_000 USDC, settled on its due date. Invoice 2: face 4_000 USDC, paid
early, outflow 3_900 USDC, its due date still in the future.

- `verifiedSettledVolume = 14_000 USDC` (faces, each invoice once). `C_allowed = min(20_000, 5_000 + 14_000 * 2000/10_000) = 7_800 USDC`.
- `E_outstanding = 3_900 USDC` (only invoice 2: paid ahead of terms and not yet due). A new early payment of 3_800 USDC:
  `3_900 + 3_800 = 7_700 <= 7_800`, **ok**, headroom 100. A new payment of 4_000 USDC: `7_900 > 7_800`, **`EXPOSURE_LIMIT`**, although
  the wallet may hold plenty of USDC.
- New supplier with no history: `C_allowed = 5_000 USDC` (owner's `newCounterpartyLimit`); with `newCounterpartyLimit = 0` it is `0` and
  every new payment is rejected until the owner sets a limit. Unknown is never rounded up.
- Indexer unreachable: `TREASURY_UNAVAILABLE`, nothing signed.

(These figures become the exposure test fixtures. Recheck the arithmetic when writing them.)

---

## C. Policy version and evidence in the decision log (SRS FR-06, FR-10, NFR-04)

### C.1 Where the policy version lives (this resolves a `VERIFY:` in `docs/DECISIONS.md`)

The signed `EarlyPayOffer` has four fields and the contract hashes that exact type string. Adding `policyVersion` to it would change
the typehash, force a contract redeploy and invalidate every signature test. It is **not needed**: `settleEarly` already takes
`decisionHash`, the contract emits it in `EarlySettled`, and `decisionHash` is the hash of the decision-log entry whose `snapshot`
we control. So the policy version and the evidence are bound to the on-chain settlement through the entry hash, with **no contract
change**. The off-chain `OfferMsg` is strict (`z.strictObject`) and stays as it is.

### C.2 Policy version and commitment

- `policyVersion`: a short public string per policy document (`supplier-1`, `buyer-1`, `exp-1`), bumped whenever any rule or
  parameter changes. A change of any parameter value **also** changes the commitment even if the version label is reused.
- `policyCommitment = keccak256(canonicalJson({ params, salt }))` where `salt` is a 32-byte secret kept in the agent's own data
  directory. The salt matters: hurdles and floors are low-entropy numbers, so an unsalted hash of them could be brute-forced from the
  public log. With a salt, the public log proves "this decision used policy X" and nothing else; the owner can reveal `params` and
  `salt` to an auditor, who recomputes the commitment.
- Owner-edited policies (`PUT /api/policy`, `PUT /api/prefs`) create a new version number and keep the previous parameters locally in
  a versions file so old decisions stay explainable.

### C.3 What goes in each log entry (additions only; the existing hash scheme is unchanged)

`snapshot` gains these fields; nothing private is added (F-0):

| Field | Content | Public? |
|---|---|---|
| `policyVersion` | label above, plus `exposurePolicyVersion` | yes |
| `policyCommitment` | salted hash above | yes (opaque) |
| `inputsCommitment` | `keccak256(canonicalJson({ inputs, salt }))`, inputs = the numbers `decide()` used (`W`, `R`, `O_due`, `S_min` or `r_buy`, history sums) | yes (opaque) |
| `evidence` | array of `{ ref, kind, provenance, txHash?, logIndex? }`; `kind` one of `balance`, `obligation`, `history`, `settlement`, `dispute`; `provenance` one of `onchain`, `policy`, `declared`, `unavailable`. **No amounts for private terms, no free text** | yes |
| `rateBps`, `rung`, `outflow` | as today | yes (the offer itself is signed and visible) |
| `result` | `{ code: ReasonCode \| "ACCEPT", range?: "overlap" \| "none" }` | yes |

The **private preimage** (`policy params`, `inputs`, `salt`) is written to the agent's local JSON-lines file in a new line type
`{ k: "d", hash, preimage }` that is never pushed to the backend. `DecisionStore.load` ignores unknown line kinds today only if added
to the `Line` union; the new kind must be added with its own test (a log with preimage lines still verifies the chain).

### C.4 Reproducibility (NFR-04) and the audit command

Every decision goes through one pure function per agent (*new* `decideBuyer`, `decideSupplier` in `core/decision.ts`) that takes
`(inputs, policy)` and returns `{ result, reasonCode, evidence }` with no clock, no randomness, no network. The model's proposal sits
beside it and never feeds `decide*`. Test: take a logged entry plus its local preimage, call `decide*`, and require the same `result`,
the same `reasonCode`, and the same `inputsCommitment`. A script `agent/src/audit.ts` (*new*, `pnpm --filter @misthos/agent audit <hash>`) does
this for an auditor who is given the preimage, and prints the formula steps (section A) with the numbers. It is a tool for an
auditor, not shown to ordinary visitors (CLAUDE.md: no terminal commands in the UI).

### C.5 Backend and API changes

- `POST /api/log/ingest`: accept and store the new snapshot fields as they are (it already stores `snapshot_json`). Add validation that
  rejects an entry whose snapshot contains a key from the private-keys list (defence in depth; the agent should already never write
  one). Tested like the existing ingest rules.
- `GET /api/log`: return `policyVersion` and `result` as top-level fields (read from `snapshot_json`) so the UI need not parse JSON.
- `GET /api/log/verify`: unchanged (hash, signature, chain).

---

## D. Negotiation trace and credit-basis UI (SRS section 10 views B, C, D)

All colour and layout rules from CLAUDE.md apply: tokens only, Sail for money and primary actions, Bossanova for anything an agent
says or decides, status colours only for status. No hard-coded hex. Every unavailable value renders "unavailable". Visitors never see
terminal commands.

### D.1 Negotiation trace on `invoices/[id]` (replaces the plain transcript in the "Negotiation and decisions" card)

For each rung, one row, newest at the bottom:
`rung | rate | price the buyer would pay (outflow) | reply (Accepted or reason text from REASON_TEXT) | signed hash | time`.
Above the rows, a **range bar** (Bossanova) showing only what the viewer is entitled to see:
- The signed rungs actually sent (public).
- After settlement, or to the two parties themselves, the final cleared rate. The counterparty's private floor or hurdle is **never**
  drawn: the bar shows the rung positions and where the deal landed, not the other side's limit.
- For the owner of an agent, their **own** side's range (supplier sees `[0, r_sup]`; buyer sees `[r_buy, 5000]`) read from their own
  agent over the authenticated control route (`AGENT_CONTROL_TOKEN`), with the reason code of each reject. Not public.
Footer line: "Decided by code under policy `<policyVersion>`; the model only suggested." with a link to the log entry and the transaction.
When `dealRange.kind === "none"`: the card says "No deal: the two sides' limits do not overlap" with the code, and shows no
settlement action. No placeholder rows.

### D.2 Credit basis panel (*new* card, same page and on both dashboards)

A table with one row per term of section B: `Allowed limit`, `Outstanding`, `This invoice`, `Headroom`, each with a provenance tag
(`on-chain`, `policy`, `declared`, `unavailable`) and, for on-chain history, a link to the transaction. Below it the evidence list
(settled invoices counted, disputed ones listed apart, overdue ones flagged without blame). Values the agent could not read show
"unavailable". The policy version used is shown. Owners edit `newCounterpartyLimit`, `growthBps`, `maxLimit` on `buyer/policy`
(and a supplier equivalent on the supplier page); saving creates a new `policyVersion`.

### D.3 Treasury and settlement states

- Treasury card (dashboards): verified USDC balance (`on-chain`), reserved liquidity `R` and declared obligations (`policy`, `declared`),
  `L_available`, outstanding exposure. Anything unreadable: "unavailable".
- State chip on every invoice and on the settlement card: `proposed`, `accepted`, `submitted`, `confirmed`, `failed`, `settled`
  (SRS FR-08). Derived only from: the signed message exchange (proposed, accepted), the wallet job status (submitted, failed) and the
  indexed contract event with its confirmation depth (confirmed, settled). A pending or failed job never renders as settled.
  `VERIFY:` how many job and wallet statuses exist today in `backend` job outbox and the Circle adapter before fixing the mapping.
- Settlement and history view: transaction hash and explorer link, the `EarlySettled` fields (net, discount, rate, fee,
  `decisionHash`), and the decision-log entry whose hash equals `decisionHash`, shown side by side. History table below lists the
  indexed settlements that feed the credit limit, each with its transaction; it states "counted once" per invoice.
- The credit feedback loop ("this settlement raised the limit from X to Y") is shown only when the numbers come from the function above
  run on real indexed events; otherwise the panel is labelled "Planned extension". This follows the SRS demo rule.

### D.4 Files

Edit: `frontend/src/app/(app)/invoices/[id]/page.tsx`, `frontend/src/components/app/OfferFlows.tsx`, `frontend/src/app/(app)/buyer/policy/page.tsx`,
`frontend/src/app/(app)/buyer/page.tsx`, `frontend/src/app/(app)/supplier/page.tsx`, `frontend/src/app/(app)/agents/page.tsx` (show policy
version in the log), `frontend/src/lib/chain/invoices.ts` (state mapping). New components: `NegotiationTrace.tsx`, `CreditBasis.tsx`,
`TreasuryCard.tsx`, `StateChip.tsx` in `frontend/src/components/app/`. Reuse `Card`, `Tag`, `Notice` as the existing pages do.

---

## 8. Tests (written with each item; nothing is "done" without them)

Agent (`agent/test/`):
1. `decision.test.ts`: the section A.4 table and both scenarios; `r_buy` by binary search equals a linear scan for 1000 random integer
   inputs (property test, seeded); monotonicity of `Out(r)`; `F` tiny and huge (no overflow, no divide by zero); `t = 0`.
2. Changing `R`, `O_due`, hurdle or `r_sup` changes the outcome in the expected direction (SRS acceptance: independent decisions).
3. Non-overlapping ranges end with `NO_OVERLAP`, zero settlement calls, no accept signed.
4. Agreement with `fitsCashPath` on single-invoice plans (A.1 double-counting rule).
5. `exposure.test.ts`: section B.5 cases; each settled invoice counted once even if its event is supplied twice; disputed excluded from growth
   and not counted as default; overdue stays outstanding without penalty and recovers on settlement; `historyAvailable=false` fails closed;
   `newCounterpartyLimit = 0` rejects.
6. `negotiation.test.ts` additions: an accepted rung is rejected with `EXPOSURE_LIMIT` when the limit is exceeded although cash is ample.
7. Log: no entry contains a private key (F-0 test); entries carry `policyVersion`, `policyCommitment`, `inputsCommitment`; a log file with
   preimage lines still verifies; replaying an entry from its preimage gives the same decision (reproducibility).
8. Protocol: reject with each new reason code validates; a reject carrying a hurdle or limit field is refused (existing forbidden-keys test extended).

Backend (`backend/test/`): ingest refuses a private key in a snapshot; `/api/log` returns `policyVersion` and `result`; `/api/exposure` returns
only chain-derived events, counted once; reconciliation with contract events (existing Anvil suites cover this once they run).

Contract (`contract/`): **no change expected.** Re-run `forge test` after the work to confirm 40 pass. If a contract change turns out to be
needed (for example to emit more in `EarlySettled`), it is a separate decision recorded in `docs/DECISIONS.md` and requires a redeploy.

Frontend (`frontend/test`, e2e): trace shows rows from a real log; no-overlap case shows "No deal" and no settle button; credit panel shows
"unavailable" when the API is unreachable; a pending job never shows "settled".

Acceptance mapping (SRS section 12):

| # | Item | Proven by |
|---|---|---|
| 1 | Wallet and business authorization | existing `e2e:accounts` |
| 2 | Invoice integrity | existing contract tests (`test_secondSettle_reverts`, others) |
| 3 | Independent agent decisions | test 2 above |
| 4 | Negotiation correctness | test 3 above |
| 5 | Credit exposure | tests 5 and 6 above |
| 6 | Signature validation | existing contract and protocol tests (wrong, expired, replayed) |
| 7 | Actual settlement | **needs the deploy and real wallets** (owner items) |
| 8 | History update | `/api/exposure` plus indexer tests; real events need the deploy |
| 9 | Failure handling | state-mapping test and e2e |
| 10 | Reproducibility | test 7 above |

---

## 9. Open decisions (owner input needed; I will propose defaults and record them if not answered)

1. Exposure sides: buyer only, or buyer and supplier (B.1). Recommendation: both.
2. The numbers in B.2: `newCounterpartyLimit`, `growthBps`, `maxLimit`, `lookbackDays`, `graceSeconds`. The defaults above are placeholders.
3. Supplier urgency input (SRS FR-03 "cash-flow urgency"): add an owner-set `urgencyBps` that *raises* the acceptable discount
   (it lifts `r_sup` toward `5000` but never above `maxRateBps`), or leave `costOfWaitingAprBps` as the only economic input.
   Recommendation: leave it for now; the SRS asks for "configured economic rules", which cost of waiting already is.
4. Obligation provenance: which `obligations.kind` values count as verified (none today, all are `declared`). Recommendation: all
   `declared` until a signed or on-chain source exists, and say so in the UI.
5. Whether to rotate the supplier agent's log after the F-0 fix (old entries show the old prefs and cannot be edited).

## 10. Order of commits

1. F-0 fix and its test. 2. `core/decision.ts`, reason codes, tests (A). 3. Wire A into `BuyerAgent` and `SupplierAgent`, backend obligations feed.
4. `core/exposure.ts`, `/api/exposure`, tests (B). 5. Policy version, commitments, preimage lines, `audit.ts`, ingest validation (C).
6. UI (D). 7. Docs: update `docs/SPEC_COMPLIANCE.md` and the README sections, record each choice in `docs/DECISIONS.md`. Small commits, push to `origin/main`.

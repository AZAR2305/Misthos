# Misthos Kit

**Two businesses' agents agree the price of waiting on an approved invoice, often 0%, and a contract on Arc settles it in under a second.**

> **Unaudited. Testnet only.** Test USDC only. Do not use funds you cannot lose. No account recovery: lose your wallet, lose your account.

Submission for the Tameion Agents Hackathon (Canteen x Circle x Arc). Everything here was written during the event (first commit 6 Oct 2026).
Last checked 14 Oct 2026; counts below are from that day. If a number here disagrees with the live site or the chain, the chain is right.

## The problem, with sources
Businesses pay each other late. B2B terms average about 45 days and a large share of invoice value is paid after its due date; the most common
reason a customer gives for paying late is its own liquidity ([Atradius 2025 survey, via Kaplan](https://www.kaplancollectionagency.com/business-advice/54-statistics-on-the-b2b-payment-delays/); secondhand, not verified against the original).
A supplier that needs cash sooner has two common options, both expensive: invoice factoring, typically 1 to 5% of the invoice per month and about 26 to 30% a year
([Fundthrough](https://www.fundthrough.com/blog/invoice-factoring/invoice-factoring-explained-costs-examples-faqs/), [Resolve Pay](https://resolvepay.com/blog/effective-annual-factoring-cost); sellers' own figures, indicative),
or an early-pay discount such as 2/10 net 30, which is about 37% a year ([Tacto](https://www.tacto.ai/en/procurement-glossary/2-10-net)). Meanwhile the buyer often holds idle cash. Each side knows something the other does not: the supplier knows what waiting costs it, the buyer knows what its cash could earn.
More in `docs/MARKET_RESEARCH.md`, with confidence ratings.

## What we built, and what is not new
**Not new:** the mechanism. Dynamic discounting exists in web2 (C2FO, Taulia, Corpay and others). We do not claim to have invented it.
**What this adds:** two *independently run* agents (a supplier agent and a buyer agent, each its own process with its own Circle Agent Wallet) that find the price of waiting from each side's *private* bounds; a contract that enforces the signed terms; price discovery that may clear at **0%** when the buyer's cash is idle; a cash-aware allocator that explains its choices;
an exposure (risk) limit that grows only on verified on-chain settlements; decisions that are logged with a policy version and a salted commitment, and replayable by their owner; and bilateral ERC-8004 ratings.
Baseline: there is no `tameion-baseline` tag in this repository. **VERIFY:** create one at the commit you consider the baseline before submission, so the compare link the checklist asks for exists. The repository's first commit (6 Oct) already holds the build spec and scaffolding.

## How it works
```
supplier agent ──signed offer (rung 0%, then up)──▶ buyer agent ──settleEarlyFlat via its Circle wallet──▶ InvoiceBook on Arc
   private: cost of waiting                           private: hurdle, cash floor, calendar,                    checks the supplier's signature,
                                                       exposure limit, ERC-8004 reading                          rate ceiling, single-use nonce, caps
                         ◀── accept, or reject with a REASON CODE (never the number) ──┘
```
1. The supplier signs an invoice (EIP-712). A relayer registers it and pays the gas. The buyer approves it on chain.
2. The supplier agent's model **proposes** a start and ceiling; **code** clamps every number into the supplier's own bounds and builds a short ladder starting at 0%. Each rung is a signed, expiring, single-use offer.
3. The buyer agent checks eligibility and its hurdle, the supplier's reputation on the ERC-8004 registry (which can only *lower* what it accepts), its exposure limit and the cash path above its floor. It answers accept, or a reject carrying only a reason code.
4. On accept, the buyer's Circle wallet calls the contract. The contract pays the supplier net of the discount, takes a 10% fee on the discount (zero at 0%), and emits an event carrying the decision hash.
5. If the two private ranges do not overlap the result is `NO_OVERLAP`: the invoice stays on its normal terms and the log says so.

**A real run (team-run, both agents ours, 14 Oct 2026):** a 40 USDC invoice due in 45 days. The supplier agent offered 0%, the buyer agent accepted on the first rung, and the full 40.00 USDC was paid early with no discount and no fee.
([transaction](https://explorer.testnet.arc.io/tx/0x7f0e67359180504dd7b00455fc85c542d43b7389536bfdb456c313f9df0c8119)). An earlier 25 USDC invoice cleared at 2% before we fixed a bug that let the model raise the opening rate
([transaction](https://explorer.testnet.arc.io/tx/0x8d581c6a48fcb14892ea647405a9370d274d80dfb9e9f7459241da1bee3ec8a1)).

## Live link and demo video
- **Live link: none yet.** The site runs locally. **VERIFY** and fill in after hosting (`docs/DECISIONS.md`, T1).
- **Demo video: not recorded yet.** The shot list is in `docs/VIDEO_SHOTLIST.md`. Before recording, run `pnpm --filter @misthos/agent doctor` and `circle wallet list --type agent --chain ARC-TESTNET`.

## Deployed contract
`InvoiceBook` on Arc testnet (chain id 5042002): [`0x108DA05Fec74a1c0620CF7D66D07AeB586A5288C`](https://explorer.testnet.arc.io/address/0x108DA05Fec74a1c0620CF7D66D07AeB586A5288C), deploy block 67164103.
It replaced a first deployment (`0xd62B…35ED`) after the real run showed Circle's CLI cannot pass a struct argument, so the contract gained `settleEarlyFlat` (flat arguments, same checks). History in `contract/DEPLOYMENTS.md`.

## Circle Agent Stack usage, and why
Both agents hold **Circle Agent Wallets** operated through the Circle CLI on Arc testnet. We use them because the agent should never hold a raw key: signing and sending go through Circle's MPC wallet.
What the first real run taught us (all in `docs/DECISIONS.md`): an Agent Wallet is a smart-contract wallet and must send one transaction before it can sign; the CLI cannot encode struct arguments; its idempotency key must be a UUID.
Not used yet: managed (developer-controlled) wallets, so a business without a browser wallet cannot settle yet.

## ERC-8004 identity and reputation (honest label: our own agents only)
Both agents are registered on the canonical Arc testnet identity registry (supplier agent **897306**, buyer agent **897307**) and each rated the other after each settlement
(four feedback transactions; owners cannot rate their own agents, so it is bilateral). **These ratings come from agents we run. They show the mechanism works; they are not independent reputation.**
The buyer reads the supplier's registry entry before accepting; it can only block or lower a limit, never raise one. No dispute rating has been written on chain and none will be faked.

## Security model: what is enforced on chain, and what is not
On chain (`contract/`, 59 Foundry tests including fuzz and invariants on `settleEarlyFlat`): signed invoices and offers (EOA or ERC-1271), a single-use offer nonce shared by both settle functions, a rate ceiling, per-invoice and daily caps set by the buyer,
net plus discount equals the face amount, fee never above the discount, an invoice settles at most once, the contract never holds funds.
Off chain: the **exposure limit is an off-chain policy layer** (it is enforced where credit is extended, at invoice registration, and by the agents); the contract caps are the on-chain bound.
The contract cannot judge whether an invoice is true; the buyer's approval is that judgement. The relayer only pays gas. Sign-in is EIP-4361; signed agent reads carry a single-use nonce and a 60-second window; claim and link codes are single-use, expiring, hashed and rate-limited; the site sends a content security policy (with `'unsafe-inline'` for scripts, a stated trade-off).

## Kit quickstart
```bash
pnpm install
pnpm --filter @misthos/agent test           # 236 tests
cd contract && forge test                   # 59 tests
pnpm --filter @misthos/backend test         # 91 tests, includes a real Anvil chain
pnpm --filter @misthos/frontend test        # 56 tests
pnpm --filter @misthos/agent doctor         # what is missing for a real run
pnpm --filter @misthos/agent shadow --invoices invoices.csv --cash 12000 --floor 5000   # no wallet needed
```
Setup for a real run (Circle login, faucet, deploy, model key): `docs/SETUP.md`. MIT licensed.

## Design notes
- **Mechanism.** Each side's range: the supplier's floor from its cost of waiting, the buyer's ceiling from its hurdle, cash path and limits. A deal exists only where they overlap (`NO_OVERLAP` otherwise). A reject carries a reason code, never a number.
- **Holdout.** An ascending-ask ladder lets a strategic buyer refuse early rungs hoping the supplier climbs. Mitigations: few rungs, short expiries, an adaptive start from proven history, and the model may only *lower* the opening rate. In our runs both agents are ours, so holdout is not exploited, and we have not measured it. A sealed-bid midpoint auction is future work (Chatterjee and Samuelson 1983; Myerson and Satterthwaite 1983: cited from memory, VERIFY).
- **Privacy.** What is public on Arc: invoice amounts, the two parties' addresses, due dates, rates and fees. What the shared server holds: a rebuildable cache of chain events, sessions, claim-token hashes and the exposure limits. What stays with each agent, encrypted at rest: the buyer's hurdle, cash floor, payment calendar, the supplier's cost of waiting, and the private inputs of every decision. Full table: `docs/DATA_AUDIT.md`. A test dumps every table of the shared store and finds none of these values.
- **Market design and revenue.** The contract's fee is 10% of the discount, so it earns nothing at 0%. That is a plan problem, not a model: other revenue (a flat minimum, a buyer-agent subscription, hosted agents, data access, funded early payment with a partner) is **a plan, nobody has paid**. `docs/GO_TO_MARKET.md`.

## How Misthos answers the three failure modes
| Failure | What stops it here | Test |
|---|---|---|
| **Wrong vendor** (money goes to the wrong address) | The payout address is the invoice's own supplier, fixed on chain; only that wallet's signature is accepted; the buyer must say who they expect to pay; a first payment to a new address is held until the buyer confirms it; a forwarded claim link cannot redirect it | `backend/test/claims-safety.test.ts` |
| **Fake invoice** | Nothing is paid until the buyer approves it on chain; a possible duplicate (same supplier, buyer, amount, reference) is flagged and refused at relayer registration unless deliberate | `claims-safety.test.ts` |
| **Retry pays twice** | A single-use signed nonce, one settlement per invoice (the contract), a stable idempotency key, and one shared decision for offers that arrive together | `agent/test/prompt-and-retry.test.ts`, contract invariants |

## Judge tour (what to click, in order)
Run it locally (`pnpm dev`; hosting is not done): `/stats` (the default view is independent pilots only and is **empty on purpose**; the Team runs tab shows our settlements, labelled) → `/invoices` and one invoice's negotiation trace → `/agents` (the signed, hash-chained log) → `/shadow` (a computation on your own numbers, nothing uploaded) → `/ledger` (double-entry export, Beancount). The explorer links above are real transactions.

## Traction: honest
**There is no independent user yet.** Both real settlements were run by our own two agents, and every ERC-8004 rating comes from those agents, so all of it is `team`, labelled so on `/stats` and in `docs/TRACTION.md`, and none of it counts as traction.
Activity is split into `pilot` (an independent business with a written note), `team` and `unverified`, never added together. A **shadow report** is a computation on a business's real data with no funds moved: it is engagement, not traction.
Pilot plan and scripts: `docs/PILOT_GUIDE.md`, `docs/PILOT_SCRIPT.md`, `docs/PILOT_LOG.md`.

## Honest limits
- The mechanism exists in web2; the value to buyers is modest, and the main value is supplier liquidity.
- Only approved invoices can be paid early; the buyer still carries dispute and performance risk.
- An early payment funded from the buyer's own cash is a payment-timing agreement, not a loan; rules vary by country (not legal advice).
- Agent Wallet spending policies are mainnet-only, so spending caps live in our contract.
- Reputation on testnet comes only from our own runs.
- Nothing has run on a hosted deployment; the failure matrix was run locally against the real Arc testnet, Circle CLI and Groq.
- The model's quality (Groq `openai/gpt-oss-120b`) on real proposals is lightly tested; code, not the model, decides every number.
- No fuzz or invariant run has covered the backend, and the contract is unaudited.
- No pilot, no revenue, no hosted site, no demo video yet.

## How to run against the Arc testnet
`docs/SETUP.md` (accounts and wallets, in order), then `agent/scripts/testnet-invoice.ts` to create a real invoice and `agent/scripts/failclosed-matrix.ts` to break each dependency on purpose. RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`, faucet via `circle wallet fund` or https://faucet.circle.com.

## Post-event plan
Find one independent pair; add managed wallets so a business needs no browser wallet; host the site and agents; add the flat per-settlement fee (needs a redeploy and an audit); and only then talk about revenue.

## Layout
`contract/` (Foundry), `agent/` (core, protocol, wallets, the two agent processes, shadow mode, audit tools), `backend/` (API, indexer, relayer), `frontend/` (the site), `docs/` (decisions, data audit, market research, pilot kit, the full build spec). License MIT.

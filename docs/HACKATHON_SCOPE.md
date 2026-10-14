# Does Misthos fit what Tameion asked? (checked 7 Oct 2026 against `docs/spec/CLAUDE-full.txt`, sections 1, 3.13, 4 and 14)

Short answer: **the idea and the architecture fit the brief well. The product code is largely there. What is missing is almost entirely real-world evidence, which only the owner can produce, plus three Tier 2 items.** Judges weigh what was built during the event, and they weigh *real* use heavily.

## The brief in one paragraph
Agents that hold, allocate and disburse a business's money, running **on Arc with USDC actually flowing, on the Circle Agent Stack**; something you will keep building; a **real business already using it** (test USDC counts, synthetic data does not); autonomy **bounded where the agent cannot reach**; judged on the **delta** built during the event. Weights: **30% agentic sophistication, 30% traction, 20% Circle tool usage, 20% innovation.** Submission: public GitHub repo, demo video under 3 minutes, live link, traction answers.

## Scorecard

| Criterion (weight) | What exists now | Gap | Who closes it |
|---|---|---|---|
| **Agentic sophistication (30%)** | Two independent agent processes with private information (supplier cost of waiting, buyer hurdle and cash plan); signed negotiation ladder; a cash-aware allocator that beats greedy-by-rate; hash-chained decision log; "the model proposes, code decides"; 73 agent tests; terminal showcase | Not yet shown on **real invoices** or a **real testnet run**; decision log is not yet shown next to the model's proposal in the UI for a real run | Owner (credentials) then run |
| **Traction (30%)** | The mechanism to onboard: claim links (built, tested end to end), accounts, public stats, ledger export | **Zero real usage.** No pilot business, no invoices with a real counterparty | **Owner**: find one real business |
| **Circle tool usage (20%)** | Circle Agent Wallet adapter via the CLI (written, tested with a scripted CLI), USDC on Arc, contract execution | **Never run against a real Circle login.** Managed wallets (Circle API) not built; relayer is a throwaway key | Owner (Circle login, API key); then I harden the adapter against real output |
| **Innovation (20%)** | Price discovery that can clear at **0%**, buyer-side agents, claim links, an open kit, a hash-chained decision log | ERC-8004 reputation (the bilateral feedback) is not built; prior art (C2FO-style dynamic discounting, Horos, CashMeIfYouCan) must be stated plainly in the README | Me (ERC-8004), owner (README claims) |

## "Never cut" list (spec 4.4)

| Item | Status |
|---|---|
| Contract and tests | **Done.** 40 Foundry tests |
| EIP-712 signing path | **Done**, verified locally and on-chain, EOA and contract wallets |
| At least one real Circle Agent Wallet in the demo | **Not done.** Needs the owner's Circle login |
| Buyer allocator and decision log | **Done** (agent core) |
| `/invoices/[id]` negotiation view | **Done** |
| Claim links | **Done this week** (backend, page, buyer tools, end-to-end test, cleared at 0%) |
| Beancount export | **Done** (UI and API). `bean-check` in CI is **not** set up |
| Judge mode | **Mostly done**: public read-only pages (the guided `/judge` tour page was removed on 6 Oct). The optional real-testnet sandbox is not built |
| `/stats` | **Done**, recomputed from the chain, labelled testnet |
| Demo video | **Not done** (owner) |
| At least one real pilot | **Not done** (owner) |

## Tier 1 and Tier 2 detail
- Tier 1 built: contract, core library, agent processes, negotiation protocol, allocator, decision log, ledger export, claim links, the main pages, backend (API, indexer, outbox), accounts.
- Tier 1 **missing**: the managed Circle wallet adapter, and the injected-attack suite is only partly written (forged message, replayed claim, forwarded claim link, retry-after-timeout exist as tests of single behaviours; the full list in spec 3.13 has not been run as one suite). The claim and forwarded-link cases are now covered by `backend/test/claims.test.ts`.
- Tier 2 **not built**: ERC-8004 identity and bilateral feedback, MCP server, A2A agent cards, Compliance Engine screening, real-testnet judge sandbox. (A2A and screening are on the cut-first list.)

## Submission checklist (spec 14), status
- [ ] Public GitHub repo (make it public; `git grep` for secrets first)
- [x] README sections drafted in `docs/`; the judge-facing README still needs the order in spec 14
- [ ] Deployed contract address and explorer link
- [ ] Live link (Vercel) that works from a clean browser with no console errors (the site builds and passes the end-to-end tests locally)
- [ ] Demo video under 3:00 with a real on-chain settlement, the 0% case and `circle wallet list --type agent --chain ARC-TESTNET`
- [ ] Traction answers: businesses onboarded, invoices, value moved, days gained, share cleared at 0%
- [ ] `docs/TRACTION.md` and a post-event plan
- [ ] Re-login both Circle CLI sessions before recording (spec said 7 days; observed about 28 on CLI 1.1.4, VERIFY; run the doctor first)
- [x] No secrets in the current tree (one throwaway Next.js build key was committed once and reverted; it is not a credential)

## Dates
Checkpoint submission **Sat 10 Oct**; final **Fri 16 Oct, 6 PM IST** (hard limit reported as 09:29 AM IST Sun 18 Oct; confirm in the Canteen Discord, this was reported by the owner and the public page said 10 Oct).

## Recommended order for the remaining days
1. **Owner, today**: Circle login for the two agent emails, fund the wallets from the faucet, deploy `InvoiceBook` to Arc testnet (`docs/SETUP.md` sections 2 to 5). Without this nothing below counts.
2. **Me, as soon as 1 is done**: run the first real testnet settlement end to end (`e2e-testnet`), fix whatever the real Circle CLI output breaks.
3. **Owner, this week**: one real business and its own invoices through a claim link. Even one counts; synthetic data does not.
4. **Me**: ERC-8004 identity and bilateral feedback (Tier 2, VERIFY the ABI on testnet), MCP read tools, the `bean-check` CI job.
5. **Owner**: demo video, public repo, Vercel deploy, submission text that states prior art and honest limits.

# Next steps: what is done, what is left, and in what order

Written 6 Oct 2026 from the build spec (`docs/spec/CLAUDE.pdf`, v3), a read of the code, and the checks run today.
Dates: **checkpoint Sat 10 Oct**, **final Fri 16 Oct, 6 PM IST** (spec 9.1; the extended hard limit of 09:29 AM IST Sun 18 Oct
is unconfirmed, ask in the Canteen Discord). Companion files: `docs/SETUP.md` (the account steps, in order),
`docs/HACKATHON_SCOPE.md` (scorecard against the brief), `docs/DECISIONS.md` (every choice and every `VERIFY:`).

## 1. Where things stand

| Part | State | Checked today |
|---|---|---|
| `contract/` InvoiceBook | Written, 40 Foundry tests, deploy scripts | **40/40 pass** (run 14 Oct; Foundry is installed in `C:\Users\thame\dev-tools\bin`) |
| `agent/` core, protocol, allocator, decision log, wallet adapters, two agent processes | Built | `tsc` clean, **182/182 tests pass** (14 Oct), including the credit and exposure layer, replayable decisions, the audit tool, the supplier's adaptive start and verified payables |
| `backend/` API, indexer, job outbox, wallet-signature sign-in, claim links, ledger exports | Built | `tsc` clean, **70/70 tests pass** (14 Oct), including both Anvil suites, the registration credit gate and `pipeline.test.ts`, which runs both agents against the real API in one process |
| `frontend/` landing, app pages, docs | Built | `tsc` clean, 45/45 tests pass; `next build` passes; `e2e:local` and `e2e:accounts` both pass in a real browser (14 Oct) |
| SRS v1.0 layer: credit limits, ranges, policy versions, audit | **Built, local only** | `docs/SRS_GAP_PLAN.md` (status per requirement) and `docs/SRS_IMPLEMENTATION_SPEC.md` (how it works, and where it differs from the plan) |
| Deployed contract on Arc testnet | **No** | The app says "unavailable" wherever it would read the chain |
| Real Circle Agent Wallets | **No** | Adapter written against a scripted CLI; never run against a real login |
| A real business using it | **No** | The one thing the judges weigh most (30%) |

Done this session on the frontend: the agent is now an abstract agent core (no person, no toy robot), the theme is a single
light/dark switch, new fonts (Bricolage Grotesque and Plus Jakarta Sans), Docs is its own tab, the Judge tour and Developer
kit pages and every terminal command shown to visitors were removed.

Agent code against the spec, with what was fixed on 6 Oct: **`docs/SPEC_COMPLIANCE.md`**.

## 2. Backend review (read of `backend/src`, tests and README)

What is sound: every route returns the `{ ok, data, error }` envelope; writes are refused from foreign origins; sign-in messages
need a one-time server nonce; wallet sign-in messages name the site; sessions are random tokens stored hashed; the relayer only
pays gas because the contract checks the supplier's signature; jobs are idempotent and survive a crash; unbuilt features answer
501 instead of faking; ledger exports are built from chain events only (no user text reaches a CSV cell).

What to fix or decide before the public link goes out:

1. **`COOKIE_SECURE` defaults to `false`.** Set it to `true` in production, with `FRONTEND_ORIGINS` set to the real site origin.
2. **Rate limiting is in memory, one process.** Fine for one server; also limit at the proxy and set `TRUST_PROXY=true` behind it.
3. **The relayer is a throwaway private key.** Fund it with a few cents of gas only and never reuse a key. The managed Circle
   wallet that replaces it (spec 5.3) is not built.
4. **No reorg handling in the indexer.** Acceptable on Arc (deterministic finality, per the notes); keep `CONFIRMATIONS` in mind
   if the chain changes.
5. **The read model is rebuilt from events on each call.** Fine at pilot scale; add a materialised table before thousands of invoices.
6. **No Content-Security-Policy yet** (wallet and three.js need a tuned policy). Spec: do last, test with a clean browser.
7. **Stats cannot yet separate real pilot invoices from the team's own test runs.** `DATA_SOURCE` is `sandbox` until a real pilot
   exists. Do not call anything a pilot until it is one.
8. **501 routes** (spec Tier 2 and 3): rounds, the server-side allocator, ERC-8004 registration and reputation, managed Circle
   wallet. Decide what to cut using spec 4.3 (cut order: Tier 3, A2A, Compliance, kit page, profile page, policy page, prose, MCP, ERC-8004).
9. **Unverified items** that only a real run settles are listed in spec Appendix A (Circle CLI flags and JSON output, wallet type
   of an Arc agent wallet, ERC-8004 ABI, Arc brand font and colours, EURC address, how judges treat testnet runs).

## 3. What to do, in order

### You (accounts and people; nobody else can do these)
- [ ] **Today.** `docs/SETUP.md` sections 1 to 5: accept the Circle CLI terms, log in two emails (supplier agent, buyer agent),
      fund both wallets from the faucet, fill `agent/.env`, run `pnpm --filter @misthos/agent doctor` until it is clean.
- [ ] **Today.** Run `forge test` in `contract/` (expect 40 green), then deploy `InvoiceBook` to Arc testnet (`contract/README.md`,
      record the address in `contract/DEPLOYMENTS.md`). Set `NEXT_PUBLIC_INVOICE_BOOK_ADDRESS`, `INVOICE_BOOK_ADDRESS`, `DEPLOY_BLOCK`.
- [ ] **Today.** Start the backend with a real Postgres (`DATABASE_URL`), and a funded relayer key. Open
      `/api/health`: every line should be green.
- [ ] **After the agents run once (`docs/SETUP.md` 7c).** Each owner signs in, sets **Credit limits**, lists the buyer's payments, makes a
      **link code** and starts the agent once with `MISTHOS_LINK_CODE`. Without the link, the agents cannot read the calendar or the limits and
      the buyer accepts nothing (on purpose). Decide the real numbers (starting limit, maximum, growth); the defaults in the docs are placeholders.
- [ ] **By Fri 9 Oct.** Find **one real business** (even a friendly supplier with a real approved invoice and a buyer who will pay
      it in test USDC). Send them a claim link. Their usage is the traction score; synthetic data does not count.
- [ ] **By Sat 10 Oct.** Submit the **checkpoint**: public repo, live link, a first demo video, and the traction answers so far.
- [ ] **Before recording.** Re-login both Circle CLI sessions (they last 7 days); the video must show
      `circle wallet list --type agent --chain ARC-TESTNET`, a real settlement on the explorer and the 0% case.

### Me (once the contract address and wallets exist)
- [ ] Run the first real testnet settlement end to end (`e2e-testnet`) and fix whatever the real Circle CLI output breaks.
- [x] Run the two Anvil suites (done 14 Oct, they pass). Still to do: the full injected-attack list as one suite
      (forged agent message, replayed claim, forwarded claim link, retry after timeout, wrong vendor, fake invoice), and CI.
- [ ] Add the `bean-check` job to CI for the Beancount export.
- [ ] Tier 2, in spec order: ERC-8004 identity and bilateral feedback (verify the ABI on testnet first), MCP read tools, then
      A2A cards and compliance screening only if time allows.
- [ ] Production hardening: tuned CSP, `COOKIE_SECURE=true`, deploy frontend (Vercel) and backend, then check the live link from a
      clean browser with no console errors.
- [ ] Replace the placeholder Arc glyph with the verified Arc vector, and confirm Arc's brand colours and font (Appendix A item 1).

### Together, Tue 13 to Fri 16 Oct
- [ ] Final README in the spec 14 order (pitch, problem with sources, what exists before, how it works with the 0% case, live link,
      contract address, Circle usage, ERC-8004 with the honest "pilot only" label, security model, honest limits, MIT, "Unaudited; testnet").
- [ ] Final demo video under 3:00 recorded against the live system; the numbers in README, video and `/stats` must match.
- [ ] `docs/TRACTION.md` and a short post-event plan.
- [ ] `git log -p | grep -i secret` sanity check; make the repo public.
- [ ] Submit by **6 PM IST Fri 16 Oct**.

## 4. Never cut (spec 4.4)
Contract and tests, the signing path, one real Circle Agent Wallet in the demo, the allocator and decision log, the invoice
negotiation view, claim links, the Beancount export, public read-only pages, `/stats`, the demo video, one real pilot.

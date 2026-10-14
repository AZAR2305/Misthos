# Misthos Kit: working notes for Claude Code

The full build specification is `docs/spec/CLAUDE-full.txt` (text extracted from `docs/spec/CLAUDE.pdf`, v3, 5 Oct 2026).
Tables lost their layout in extraction; when a table matters, check `docs/spec/CLAUDE.pdf`. When this summary and the
spec disagree, the spec wins. When the spec is silent, choose the smallest reasonable option and record it in
`docs/DECISIONS.md`.

## What we are building
Misthos Kit: an open agent kit for business payment timing, settled on Arc (Circle's L1, testnet chain id
5042002). Two businesses each run their own agent. The supplier agent starts at 0% and climbs a short ladder of
signed early-pay offers; the buyer agent allocates idle USDC across approved invoices under a private hurdle
rate. A contract (`InvoiceBook`) enforces the signed terms and settles in under a second. The cleared price is
often 0%. Hackathon: Tameion Agents Hackathon (Canteen x Circle x Arc). Final submission Fri 16 Oct 2026, 6 PM IST.

## Binding rules (spec section 0, shortened)
- Real data only. No mocks, seeded or demo data, simulations or fallbacks. Unknown values render "unavailable".
  The agents stage on the landing page is a labelled illustration with no numbers.
- Money is bigint minor units (6 decimals). Never floats. Convert only at the UI edge.
- The model proposes, code decides. No model output reaches a signer or a contract call.
- Tokens only: `frontend/design/tokens.css` (spec 10.2) is imported once in the root layout. No hard-coded hex in UI code
  (the three.js scene reads the same hex values from the Arc palette; keep them in sync).
- Colour carries meaning: Sail = money and primary actions, Bossanova = anything an agent says or decides,
  white = text and human actions, green/amber/red = status only.
- Mark anything unverified `VERIFY:` in code and in `docs/DECISIONS.md`.

## Repo layout
- `frontend/` Next.js 16 (App Router) + Tailwind 4. Landing page and 3D scene in `src/components/landing`; tokens in `design/tokens.css`.
- `contract/` Foundry: `InvoiceBook.sol`, 40 tests, deploy script. `lib/` is gitignored (`forge install`, see its README).
- `agent/` core library, negotiation protocol, wallet adapters, supplier and buyer agent processes. `pnpm doctor` shows what is missing.
- `backend/` REST API, chain indexer, job outbox, wallet-signature sign-in (no Google, no email). Hono + Postgres (PGlite for local/tests). See backend/README.md.
- `docs/` DECISIONS, design plan, inspiration notes, spec.

## Dev notes
- Tests: `cd contract && forge test`; `pnpm --filter @misthos/agent test`; `pnpm --filter @misthos/backend test` (includes a real Anvil chain); real-browser end-to-end: `pnpm --filter @misthos/frontend e2e:local` (wallet only) and `e2e:accounts` (Google + wallet + side, with the backend).
- Commit in small steps and push to origin/main. Never commit `.env` files (only `.env.example`).
- `pnpm dev` from the repo root. `pnpm --filter @misthos/frontend shots` captures screenshots at 375/768/1280.
- This machine's Node resolves only IPv6 for some hosts, which times out. Run npm/pnpm/node network commands with
  `NODE_OPTIONS="--require C:/Users/thame/.node-shims/ipv4.js"` (a shim that forces IPv4 lookups).
- Fonts come from `@fontsource/*` (no network at build time), not `next/font/google`.
- Next generated `frontend/AGENTS.md` and `frontend/CLAUDE.md` telling agents to read `node_modules/next/dist/docs/`
  before using Next APIs. Follow that.

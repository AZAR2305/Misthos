# Hosting: what is ready, what needs your accounts, and the exact steps

**Status 14 Oct 2026: nothing is hosted.** Hosting needs accounts only you can create. This file is everything that can be prepared without them. Nothing here has been run on a host; every
host-specific claim is marked VERIFY. Do not tell anyone the site is live until `GET /api/health` on the real URL says so.

## What you need to create (I cannot do these)
1. A **Vercel** account (the website) and a **Railway** or **Fly.io** account (the backend, indexer and the two agent processes), with a payment method if the free tier does not allow a persistent volume (VERIFY on the host's pricing page).
2. Your **Circle login** on the host: an agent process needs its Circle CLI login state, and that login is an email code that only you can type. The exact step is below; it is not worked around.
3. A **dedicated Arc RPC URL** for the site. The public endpoint answered a browser with HTTP 429 during testing, so a hosted site that many people load would be throttled. The Canteen node needs a key from `arc-canteen login` (VERIFY the terms).

## Architecture (single instance, on purpose)
- **Website** (`frontend/`): Vercel. Static plus client-side reads from Arc. Set the project's root directory to `frontend`.
- **Backend** (`backend/`): one Node process (API, indexer and relayer together) with an **embedded database (PGlite) on a persistent volume**. No hosted database. `DATABASE_URL=pglite:///data/backend`.
- **Supplier agent** and **buyer agent** (`agent/`): two more processes, each with its **own volume** holding its encrypted private files (`AGENT_DATA_DIR`) and its Circle login folder (`SUPPLIER_CIRCLE_CLI_HOME` or `BUYER_CIRCLE_CLI_HOME`).
- Limits to state honestly: **one instance only** (PGlite is single-writer, and the rate limiter is in memory); **manual backups** (copy the volume; VERIFY the host's snapshot feature); a redeploy must keep the volume mounted. The database is a cache of the chain plus small operational data, so losing it loses sessions and claim links, not money or history.

## Environment (set in the host's secret store, never in git)
| Service | Variables |
|---|---|
| Backend | `ARC_RPC_URL`, `ARC_CHAIN_ID=5042002`, `INVOICE_BOOK_ADDRESS=0x108DA05Fec74a1c0620CF7D66D07AeB586A5288C`, `DEPLOY_BLOCK=67164103`, `FRONTEND_ORIGINS=https://<your site>`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `DATABASE_URL=pglite:///data/backend`, `RELAYER_PRIVATE_KEY` (a funded throwaway), `AGENT_WALLETS=<both agent addresses>` |
| Each agent | the contents of `agent/.env` for that role, plus `AGENT_STORE_KEY` (32 random bytes), `AGENT_DATA_DIR=/data/agent`, `AGENT_HOST=0.0.0.0` only if the host needs it (and then `AGENT_CONTROL_TOKEN` is mandatory), `BACKEND_URL=<the backend's URL>`, `BUYER_AGENT_URL` for the supplier agent |
| Website (Vercel) | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_INVOICE_BOOK_ADDRESS`, `NEXT_PUBLIC_EXPLORER_URL`, `NEXT_PUBLIC_SITE_URL`, optionally `NEXT_PUBLIC_BUYER_AGENT_URL` |
Rotate the Groq key first: the one pasted into chat on 14 Oct must not be used on a host.

## The Circle login on the host (the exact step; do not skip it)
Each agent's login is stored in its own folder on its own volume. On the host, open a shell in that agent's service (Railway: `railway shell`; Fly: `fly ssh console`; VERIFY the command on your host) and run:
```
CIRCLE_CLI_HOME=/data/circle pnpm exec circle wallet login <the email you used for this agent> --testnet
```
Type the code Circle emails you. Then `pnpm --filter @misthos/agent doctor` inside the service must show every line `ok`. Sessions were about 28 days on CLI 1.1.4 on 14 Oct (VERIFY). When one expires the agent stops, reports `SESSION_EXPIRED` and the exact command on `/health`.

## Acceptance (tick only after you have looked)
- [ ] A clean browser opens the live URL; `/`, `/stats`, `/ledger`, `/invoices` load with honest empty states (the pilot tab on `/stats` is empty on purpose).
- [ ] `GET /api/health` reports RPC, database, relayer address and balance, and indexer lag truthfully.
- [ ] Each agent's `/health` reports its wallet (and whether it is activated), the model, and its session.
- [ ] No console errors, and no content-security-policy violations, on the MVP pages.
- [ ] The fail-closed matrix (`agent/scripts/failclosed-matrix.ts`) run from the host passes 4 of 4.
- [ ] Write the live URL and the host choices into `docs/DECISIONS.md`.

## Prepared files
There is deliberately no Dockerfile or `railway.json` in the repository yet: Docker was not available on the build machine, so an image could not be built and tested, and an untested one would only look finished.
Railway and Fly can build a Node service from the repository with the start commands `pnpm --filter @misthos/backend start`, `pnpm --filter @misthos/agent supplier` and `pnpm --filter @misthos/agent buyer`. VERIFY on first deploy.

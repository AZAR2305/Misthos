# Hosting checklist: Vercel (website, done) and Render (backend and agents)

Status 14 Oct 2026. **Website: live** at https://misthos-kit.vercel.app (Vercel project `misthos-kit`, account `azars-projects-e39ca787`, deployed from this machine). **Backend and agents: not hosted.** Everything marked VERIFY below was written
from general knowledge of Render and has not been done on your account; check each screen as you go and tell me where it differs. No value of any secret appears in this file: only names.

Do not say "live" about anything except what a clean browser can open. The website is live in **wallet-only mode** (no accounts, because there is no hosted backend yet).

## Part A: the website on Vercel (already done; how to change it)
What exists: project `misthos-kit`, Root Directory `frontend`, "include source files outside the Root Directory" on (the site imports the agent's pure core), framework Next.js, production alias `misthos-kit.vercel.app`.
Only an allowlist of files is uploaded (`.vercelignore`): the website source, `agent/src/core`, and the workspace manifests. No env file, database, agent data or contract cache is ever uploaded.

**Environment variables set in Vercel (Production):**
`NEXT_PUBLIC_INVOICE_BOOK_ADDRESS`, `NEXT_PUBLIC_EXPLORER_URL`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_SITE_URL`.
**Add these when the backend is hosted (Part B), then redeploy:** `NEXT_PUBLIC_API_URL`. Optional: `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_DEPLOY_BLOCK`, `NEXT_PUBLIC_BUYER_AGENT_URL`, `NEXT_PUBLIC_SUPPLIER_AGENT_URL` (leave the agent URLs unset: agents run on each owner's own machine).

**To redeploy from this machine:** `npx vercel@latest deploy --prod --yes` in the repo root (the installed Vercel CLI 46 is too old for the upload endpoint; `npx vercel@latest` works).
Or in the Vercel dashboard: Project `misthos-kit` > Deployments > the three dots on the latest > Redeploy.

**RPC note (found in testing):** `https://rpc.testnet.arc.io` answered the browser with HTTP 429 on the site's log reads, and so did the QuickNode endpoint. `https://rpc.blockdaemon.testnet.arc.io` allowed bursts and any origin, so the site uses it. A keyed RPC (Canteen) is still better; when you have one, change `NEXT_PUBLIC_RPC_URL` in Vercel and redeploy.

## Part B: backend and agents on Render (click by click)
**Plan (single instance, on purpose):** three services. Render's free tier has no persistent disk (VERIFY on https://render.com/pricing), and the backend database and each agent's private files must survive a restart, so use a paid instance type with a **disk** for each. Limits to state honestly: one instance only (PGlite is single-writer and the rate limiter is in memory); manual backups (disk snapshots, VERIFY); a deploy must keep the disk mounted.

### B1. Connect the repository
1. Go to https://dashboard.render.com and sign in.
2. Click **New +** > **Web Service**.
3. Choose **Build and deploy from a Git repository** > **Next**. Click **Connect GitHub** (first time only), approve access to `AZAR2305/Misthos`, then select it.
4. Branch `main`. Leave Root Directory empty (the services need the whole workspace).

### B2. Backend service
1. Name `misthos-backend`. Region: the one nearest you. Runtime **Node**.
2. Build command: `corepack enable && pnpm install --frozen-lockfile`
3. Start command: `pnpm --filter @misthos/backend start`
4. Instance type: a paid one that offers a disk (VERIFY the cheapest).
5. Under **Advanced** > **Add Disk**: Name `backend-data`, Mount Path `/data`, Size 1 GB.
6. Health Check Path: `/api/health`
7. Add the environment variables below (click **Add Environment Variable** for each; use **Secret Files** or the secret toggle for the secret ones).
8. Click **Create Web Service**. When it says **Live**, open `https://<service>.onrender.com/api/health` in a clean browser and read every field.

**Backend environment variable names:**
`PORT` (leave to Render), `ARC_RPC_URL`, `ARC_CHAIN_ID`, `INVOICE_BOOK_ADDRESS`, `USDC_ADDRESS`, `DEPLOY_BLOCK`, `DATABASE_URL`, `FRONTEND_ORIGINS`, `COOKIE_SECURE`, `TRUST_PROXY`, `RATE_LIMIT_PER_MIN`, `REGISTER_LIMIT_PER_HOUR`, `RELAYER_MIN_BALANCE_WEI`, `SESSION_TTL_DAYS`, **secret:** `RELAYER_PRIVATE_KEY`, `AGENT_WALLETS` (public addresses, comma separated).
Values to remember: `DATABASE_URL` is `pglite:///data/backend` (the disk), `FRONTEND_ORIGINS` is the Vercel URL, `COOKIE_SECURE` and `TRUST_PROXY` are `true`.

### B3. Buyer agent service
1. **New +** > **Web Service**, same repository. Name `misthos-buyer-agent`. Runtime **Node**.
2. Build command: `corepack enable && pnpm install --frozen-lockfile`
3. Start command: `pnpm --filter @misthos/agent buyer`
4. Disk: Name `buyer-data`, Mount Path `/data`, 1 GB.
5. Make it reachable by the supplier agent only. Prefer a **Private Service** (VERIFY the option name) so only your other services reach it; if you use a Web Service it is public, so `AGENT_CONTROL_TOKEN` is mandatory.
6. Environment variable names: `ARC_RPC_URL`, `ARC_CHAIN_ID`, `INVOICE_BOOK_ADDRESS`, `USDC_ADDRESS`, `BUYER_AGENT_WALLET_ADDRESS`, `SUPPLIER_AGENT_WALLET_ADDRESS`, `BUYER_CIRCLE_CLI_HOME` (`/data/circle`), `AGENT_DATA_DIR` (`/data/agent`), `AGENT_HOST` (`0.0.0.0`), `BUYER_AGENT_PORT`, `BACKEND_URL`, `MODEL_PROVIDER`, `GROQ_MODEL`, `ERC8004_IDENTITY`, `ERC8004_REPUTATION`, `SUPPLIER_ERC8004_ID`, `BUYER_ERC8004_ID`, `BUYER_HURDLE_APR_BPS`, `BUYER_LIQUIDITY_FLOOR`, `BUYER_PER_INVOICE_CAP`, `BUYER_DAILY_CAP`, `BUYER_HUMAN_ABOVE`, `BUYER_NEW_ADDRESS_CAP`, `FEE_BPS`, `LADDER_RUNG_SECONDS`, `AGENT_ALLOWED_ORIGINS`, **secrets:** `GROQ_API_KEY` (the new one, after rotation), `AGENT_STORE_KEY`, `AGENT_CONTROL_TOKEN`.

### B4. Supplier agent service
Same as B3 with: name `misthos-supplier-agent`, start command `pnpm --filter @misthos/agent supplier`, disk `supplier-data`, and `SUPPLIER_CIRCLE_CLI_HOME`, `SUPPLIER_AGENT_PORT`, `BUYER_AGENT_URL` (the buyer service's internal URL), `SUPPLIER_COST_OF_WAITING_APR_BPS`, `SUPPLIER_MAX_RATE_BPS`, `SUPPLIER_START_RATE_BPS`, `SUPPLIER_STEP_BPS` in place of the buyer ones. Secrets: `GROQ_API_KEY`, `AGENT_STORE_KEY`, `AGENT_CONTROL_TOKEN`.

### B5. The Circle login on each agent (only you can do this)
1. Open the agent service in Render > **Shell** tab (VERIFY: Shell may need a paid instance).
2. Accept the Circle terms once and log in, with that agent's own email:
   `CIRCLE_CLI_HOME=/data/circle pnpm exec circle wallet login <the email for this agent> --testnet`
3. Type the code Circle emails you.
4. Run `pnpm --filter @misthos/agent doctor` in the same shell. Every line must say `ok`.
5. Repeat for the other agent. The two agents use different emails and different folders.
When a session expires the agent stops and its `/health` shows the exact command (`SESSION_EXPIRED`).

### B6. Point the website at the backend
1. Copy the backend's `https://<service>.onrender.com` URL.
2. Vercel > Project `misthos-kit` > **Settings** > **Environment Variables** > add `NEXT_PUBLIC_API_URL` (Production) with that URL > **Save**.
3. Backend service > set `FRONTEND_ORIGINS` to `https://misthos-kit.vercel.app` > **Save, rebuild and deploy**.
4. Vercel > **Deployments** > the latest > **Redeploy**.

## Acceptance (tick only after you have looked)
- [ ] A clean browser opens https://misthos-kit.vercel.app; `/`, `/stats`, `/shadow`, `/invoices`, `/ledger`, `/agents` load; the pilot tab on `/stats` is empty on purpose and the Team runs tab shows our two settlements.
- [ ] No red errors in the browser console on those pages, and no CSP violation.
- [ ] `GET <backend>/api/health` shows the database, RPC, relayer balance and indexer lag truthfully.
- [ ] Each agent's `/health`: wallet ok and activated, model configured, session valid.
- [ ] Sign in with a real browser wallet on the live site; `/api/me` shows only an address.
- [ ] `agent/scripts/failclosed-matrix.ts` run from a host shell: 4 of 4.
- [ ] Write the live URLs and host choices into `docs/DECISIONS.md`.

## Not prepared, on purpose
No Dockerfile or `render.yaml` exists: Docker was not running on the build machine, so an image could not be tested, and Render can build Node services directly with the commands above. If you want infrastructure-as-code later, a `render.yaml` can be added once the first manual deploy has shown which settings are right.

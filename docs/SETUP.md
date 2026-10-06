# Setup: the steps only you can do

Everything here needs your accounts, your email, a captcha or a legal acceptance, so it cannot be automated. Do them in
order. After each block, run the doctor to see what is still missing:

```powershell
pnpm --filter @misthos/agent doctor
```

Windows PowerShell is assumed. If `pnpm` commands time out on this machine, first run
`$env:NODE_OPTIONS = "--require C:/Users/thame/.node-shims/ipv4.js"` (see "Machine quirk" in `docs/DECISIONS.md`).

---

## 1. Create `agent/.env`

```powershell
cd C:\Users\thame\Misthos\agent
copy .env.example .env
```

Open `agent/.env` in your editor. Keep it open: you fill it in over the next steps. Never commit it (it is gitignored).
Set the two login folders now (change `thame` if your user name differs):

```
SUPPLIER_CIRCLE_CLI_HOME=C:/Users/thame/.misthos/circle-supplier
BUYER_CIRCLE_CLI_HOME=C:/Users/thame/.misthos/circle-buyer
```

---

## 2. Accept the Circle CLI terms (once per login folder)

Why you: this is a legal agreement with Circle. Read it first: https://agents.circle.com/terms-of-use and
https://www.circle.com/legal/privacy-policy

```powershell
cd C:\Users\thame\Misthos\agent
$env:CIRCLE_CLI_HOME = "C:/Users/thame/.misthos/circle-supplier"
pnpm exec circle wallet status
```

It prints the terms and asks you to accept. Type the accept answer. Then repeat for the buyer:

```powershell
$env:CIRCLE_CLI_HOME = "C:/Users/thame/.misthos/circle-buyer"
pnpm exec circle wallet status
```

(The CLI's own non-interactive switch is `CIRCLE_ACCEPT_TERMS=1`. It means the same thing as accepting, so only set it
yourself once you have read the terms.)

---

## 3. Create the two agent wallets (Circle login, email code)

You need two email addresses you can open: one for the supplier agent, one for the buyer agent. Spec 13 asks for two.
(A second Gmail alias such as `you+buyer@gmail.com` may work; that is unverified.)

Supplier agent:

```powershell
$env:CIRCLE_CLI_HOME = "C:/Users/thame/.misthos/circle-supplier"
pnpm exec circle wallet login SUPPLIER_EMAIL@example.com --testnet
```

1. The CLI shows an anti-phishing prefix and waits for a code.
2. Open the email from Circle. The code looks like `B1X-123456`.
3. Type the 6 digits (or the full code). The first login also creates an agent wallet on every supported chain.

Then list the wallet and copy the Arc address:

```powershell
pnpm exec circle wallet list --chain ARC-TESTNET --type agent
```

Paste it into `agent/.env` as `SUPPLIER_AGENT_WALLET_ADDRESS=0x...`.

Buyer agent: repeat with the buyer folder and the other email:

```powershell
$env:CIRCLE_CLI_HOME = "C:/Users/thame/.misthos/circle-buyer"
pnpm exec circle wallet login BUYER_EMAIL@example.com --testnet
pnpm exec circle wallet list --chain ARC-TESTNET --type agent
```

Paste into `BUYER_AGENT_WALLET_ADDRESS=0x...`.

Sessions last 7 days. When one expires the agent stops and reports `SESSION_EXPIRED`; log in again with the same
command. Re-login right before you record the demo video.

If you prefer two steps (for scripts): `circle wallet login EMAIL --type agent --init` prints a request id, then
`circle wallet login --request REQUEST_ID --otp B1X-123456`.

---

## 4. Get test USDC (faucet, needs a captcha)

Website: **https://faucet.circle.com**

1. Choose the network **Arc Testnet** and the token **USDC**.
2. Paste an address and complete the captcha, then request. Do it for each address:
   - the supplier agent wallet (for gas-free signing it needs little, but fund it),
   - the buyer agent wallet (this is the treasury that pays invoices: give it the most),
   - the contract deployer: `0xe56357E6eFe146a33223Dd90f11bCA992C1B137C` (needs about 0.2 USDC for gas).
3. Agent wallets can also draw a small amount from the CLI:
   `pnpm exec circle wallet fund --address 0xYOURADDRESS --chain ARC-TESTNET` (run with the right `CIRCLE_CLI_HOME`).

Check a balance (minor units, 6 decimals; 1 USDC = 1000000):

```powershell
cd C:\Users\thame\Misthos\contract
cast balance 0xe56357E6eFe146a33223Dd90f11bCA992C1B137C --rpc-url https://rpc.testnet.arc.io
```

The doctor also prints both agent balances.

---

## 5. Deploy the contract

```powershell
cd C:\Users\thame\Misthos\contract
forge test                                                   # must be green first
forge script script/Deploy.s.sol --rpc-url arc_testnet       # dry run against the real chain
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
```

The output says `InvoiceBook deployed at 0x...`. Then:

1. Put the address in `agent/.env` as `INVOICE_BOOK_ADDRESS=0x...`.
2. Add a row to `contract/DEPLOYMENTS.md`.
3. For the website's proof row: create `frontend/.env.local` with
   `NEXT_PUBLIC_INVOICE_BOOK_ADDRESS=0x...` (and on Vercel, add the same variable and redeploy).
4. Each buyer wallet must approve the contract to move its USDC once:
   `pnpm exec circle wallet execute "approve(address,uint256)" INVOICE_BOOK_ADDRESS 1000000000 --contract 0x3600000000000000000000000000000000000000 --address BUYER_WALLET --chain ARC-TESTNET`
   (with the buyer's `CIRCLE_CLI_HOME`; the amount is 1,000 USDC in minor units).
5. Commit `contract/deployments/5042002.json` and `DEPLOYMENTS.md` (not `.env`).

Check on the explorer: https://explorer.testnet.arc.io/address/YOUR_CONTRACT

---

## 6. Add the model key

Website: **https://console.anthropic.com**

1. Sign in, open **Settings → Billing** and add credits (API calls are paid; the key does nothing without credit).
2. Open **Settings → API keys → Create key**, name it `misthos-agents`, copy it once.
3. Put it in `agent/.env`: `ANTHROPIC_API_KEY=sk-ant-...`. Never commit or share it.

---

## 7. Check everything and run the agents

```powershell
pnpm --filter @misthos/agent doctor      # every line should say ok
pnpm --filter @misthos/agent buyer       # terminal 1, http://localhost:4102/health
pnpm --filter @misthos/agent supplier    # terminal 2, http://localhost:4101/health
```

Tell me when the doctor is green and I will build the real-chain end-to-end script (register, approve, ladder, settle,
explorer links) and run it with you.

---

## 7b. Turn on accounts: Google sign-in and the backend (optional, recommended)

Without this the app works with just a wallet. With it, every supplier and buyer is one Google identity linked to one
wallet and one side.

1. **Create a Google client id** (free, about 5 minutes): https://console.cloud.google.com → create or pick a project →
   **APIs & Services → OAuth consent screen** (External, add your email as a test user) → **Credentials → Create
   credentials → OAuth client ID → Web application**. Under **Authorised JavaScript origins** add `http://localhost:3000`
   (and your Vercel URL later). Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It is public; there is
   no secret to keep.
2. **Backend**: `cd backend && copy .env.example .env`, then fill in `GOOGLE_CLIENT_ID`, `ARC_RPC_URL`,
   `INVOICE_BOOK_ADDRESS`, `DEPLOY_BLOCK` (from step 5) and, to let the server pay gas for suppliers,
   `RELAYER_PRIVATE_KEY` (a **new throwaway key** with a little test USDC; never reuse a funded key; never commit it).
   Run `pnpm --filter @misthos/backend start` and open http://localhost:4000/api/health: every part you configured
   should say so. With no `DATABASE_URL` it keeps an embedded database in `backend/.data`.
3. **Frontend**: in `frontend/.env.local` set `NEXT_PUBLIC_API_URL=http://localhost:4000` and
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID=<the client id>`, then restart `pnpm dev`. /app now shows the three steps: sign in,
   link wallet, choose side.
4. **For a hosted server** (Railway, Fly, Render): set the same variables there, add a Postgres database and put its
   URL in `DATABASE_URL`, set `FRONTEND_ORIGINS` to your site URL and `COOKIE_SECURE=true`, and add that site to the
   Google client's authorised origins.

---

## 8. Before you submit

- **Make the GitHub repo public**: https://github.com/AZAR2305/Misthos → **Settings → General → Danger Zone → Change
  visibility → Make public**. The hackathon requires a public repo and the site links to it. Run
  `git grep -nE "PRIVATE_KEY=0x|sk-ant"` first; it must print nothing.
- **Publish the site** (optional now, needed for the live link): https://vercel.com/new → import the repo → set
  **Root Directory** to `frontend` → add `NEXT_PUBLIC_INVOICE_BOOK_ADDRESS` → deploy.
- **Confirm the deadline and rules** in the Canteen Discord and on the submission form (the spec says 17 Oct was
  reported by the project owner; the public page showed 10 Oct).
- **Get a real pilot**: at least one real business whose own invoices run through the system, with written
  permission to quote them (spec 9.6). Test USDC counts; seeded or scripted data does not.

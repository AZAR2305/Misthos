# backend

The Misthos API, chain indexer and durable job outbox (spec 5.3, 6 and 9.2), one Node process. It reads InvoiceBook's events
into Postgres, serves the public pages' data, signs people in with a wallet signature (one wallet is one account), and submits
`registerInvoice` for suppliers through a relayer. Every part that lacks its configuration stays off and says so in
`/api/health`; nothing is faked.

```bash
cp .env.example .env          # fill in what you have; every line is optional
pnpm --filter @misthos/backend start     # http://localhost:4000/api/health
pnpm --filter @misthos/backend test      # 22 tests, including one against a real Anvil chain and the real contract
```

With no `DATABASE_URL` it uses an embedded Postgres (PGlite) in `./.data`, so you need nothing installed. Set
`DATABASE_URL=postgres://…` for a server.

## How a person is identified

1. **Wallet**: the server issues a one-time message naming the wallet, the site and the network; the wallet signs it (no
   transaction, no gas); the server checks the signature (ECDSA, or ERC-1271 for contract wallets), spends the message once, and
   finds or creates the account for that address. The address is the whole identity: no email, no password, no third party.
   The session is an opaque random token in an HttpOnly cookie; only its SHA-256 is stored.
2. **Side**: supplier or buyer, stored on the account. Switching needs `confirm: true`.

There is no account recovery: losing the wallet means losing the account. The contract still enforces everything by signature,
so a stolen session alone cannot move money, sign an invoice or pay anyone.

## API (envelope `{ ok, data, error }`; money fields are USDC minor-unit strings, 6 decimals)

| Route | Who | What |
|---|---|---|
| `GET /api/health` | anyone | db, rpc, contract, indexer lag, relayer |
| `POST /api/auth/wallet/challenge` `{address}` → `POST /api/auth/wallet/signin` `{address,nonce,signature}` | anyone | sign in: get the one-time message, then send the signature; sets the session cookie |
| `POST /api/auth/logout`, `GET /api/me` | session | sign out; who am I (address, side) and which step is next |
| `PUT /api/me/side` `{side, confirm?}` | session | choose supplier or buyer |
| `GET /api/invoices`, `GET /api/invoices/:id` | anyone | indexed invoices with filters; one invoice and its events |
| `GET /api/stats` | anyone | settlements and the summary, computed from chain events |
| `GET /api/ledger`, `.csv`, `.beancount` | anyone (`?address=&side=`) or session | double-entry journal and exports |
| `GET /api/log/verify`, `GET /api/agents` | anyone | recompute the decision hash chain; agent profiles |
| `POST /api/relay/register` | supplier | verify the signed invoice, queue `registerInvoice` |
| `GET /api/jobs/:id` | the job's owner | job status |
| `GET/PUT /api/policy`, `/api/obligations`, `/api/prefs` | buyer / supplier | private settings per organisation |

Not built (they answer 501, never a fake): rounds (Tier 3), standing offers and claim links, the server-side allocator,
ERC-8004 registration and reputation, a managed Circle wallet relayer.

## Design notes

- **One implementation.** ids, discounts, the journal and the stats come from the same pure code the UI and agents use
  (`src/shared.ts` re-exports it). The read model is the stored events folded by `buildInvoices`, so the API and the app
  cannot disagree. Fine for pilot scale; add a materialised table before thousands of invoices.
- **Indexer**: polls `getLogs` from a stored cursor, writes events, block times and the cursor in one transaction; events are
  unique on `(tx_hash, log_index)`, so re-reading history is harmless. No reorg handling (Arc has deterministic finality);
  set `CONFIRMATIONS` on a chain that can reorg.
- **Outbox**: a job's idempotency key is deterministic (`register:<invoiceId>`), and the handler reads the chain before it
  sends, so a restart or a double request never double-sends. Retryable errors back off; a contract revert fails at once.
- **Relayer** pays gas only. `registerInvoice` is permissionless and checks the supplier's signature on-chain. VERIFY: the
  key-based relayer stands in for the Circle managed wallet (spec 5.3) until a Circle API key exists. VERIFY: gas
  estimation on Arc (simulate first, explicit fallback limit).
- **Origin check + CORS** for cookie sessions; `FRONTEND_ORIGINS` lists the allowed pages. Set `COOKIE_SECURE=true` behind HTTPS.
- Rate limiting is not built yet; put the API behind a proxy that limits `/api/auth/*` before a public launch.

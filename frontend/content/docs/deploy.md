---
title: Deploy to production
order: 8
summary: Deploy the contract, the backend and this site, and the settings each one needs.
---

# Deploy to production

Three pieces, each independent: the **contract** on Arc, the **site**, and an optional **backend** for accounts.

## 1. The contract

Deploy InvoiceBook to Arc testnet with Foundry, then note two values: the **contract address** and the **block number** it was deployed in.

## 2. The site (Vercel)

Import the repository, set the **Root Directory** to `frontend`, add the variables below, and deploy.

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_INVOICE_BOOK_ADDRESS` | The deployed contract address. Without it the site says "not live yet". |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | The block it was deployed in, so scans start there. |
| `NEXT_PUBLIC_SITE_URL` | The public address of the site (for link previews and the sitemap). |
| `NEXT_PUBLIC_API_URL` | The backend, if you run one. Leave empty to run on a wallet alone. |

All of these are public values. Never put a private key or an API secret in a `NEXT_PUBLIC_` variable.

## 3. The backend (optional)

Run it on any Node host with a Postgres database. It needs the contract address, an Arc RPC URL, the site's address in `FRONTEND_ORIGINS` and `COOKIE_SECURE=true`. It can also pay gas to register invoices for suppliers using a throwaway relayer key.

## After deploying

Open the site and check: the header shows your network live, **Overview** loads, and the Live stats page reads the chain. Make sure no secret appears anywhere in the repository before you make it public.

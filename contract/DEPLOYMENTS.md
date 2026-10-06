# Deployments

Record every deployment here (CLAUDE.md 7.7). `script/Deploy.s.sol` also writes `deployments/<chainId>.json`.

| Network | Chain id | InvoiceBook | Deploy tx | Date | Notes |
|---|---|---|---|---|---|
| Arc testnet | 5042002 | not deployed yet | | | |

Deploy:
```bash
cd contract
cp .env.example .env          # then set DEPLOYER_PRIVATE_KEY and fund it at https://faucet.circle.com
forge test                    # must be green first
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
```
After deploying, put the address in `INVOICE_BOOK_ADDRESS` (contract/.env, agent/.env, backend/.env, frontend/.env.local),
then have each buyer wallet `approve(InvoiceBook, allowance)` on USDC once before the first settlement.

# contract

`InvoiceBook.sol` (CLAUDE.md section 7): verifies signed invoices and signed early-pay offers (EOA and ERC-1271),
enforces per-invoice and daily caps and a 50% APR ceiling, takes a success fee as a share of the discount, and settles
an invoice exactly once. `settleBatch` (Tier 3) pays up to 20 invoices atomically. **Unaudited. Testnet only.**

## Setup
`lib/` is not committed. Restore the dependencies once:
```bash
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std --no-git
forge test          # 40 tests, including the CLAUDE.md Appendix B numbers, ERC-1271 wallets and a fuzz run
```

## Environment
```bash
cp .env.example .env    # then set DEPLOYER_PRIVATE_KEY (never commit .env)
```
Fund the deployer at https://faucet.circle.com (Arc Testnet). A deploy costs about 0.13 USDC in gas.

## Deploy
```bash
forge script script/Deploy.s.sol --rpc-url arc_testnet              # dry run against the real chain
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast  # real deploy
```
The script refuses Arc mainnet unless `CONFIRM_MAINNET=1`, checks that USDC has code and 6 decimals, and records real
broadcasts in `deployments/<chainId>.json`. Add the address to `DEPLOYMENTS.md`.

## Layout
- `src/InvoiceBook.sol` the contract
- `test/InvoiceBook.t.sol` spec 7.5 invariants and 7.6 required tests
- `test/utils/` a 6-decimal test token and ERC-1271 test wallets (unit-test fixtures only)
- `script/Deploy.s.sol` deployment

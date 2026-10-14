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

## Arc testnet (chain 5042002), 14 Oct 2026
- InvoiceBook: `0xd62B53a4d3a7Cc56467F75cdA8dA246eA2aB35ED`
- Deploy transaction: `0xdcfb3799e99a3611d486765d7e45935ca2761f57bc4ae2d5218331c7e9ddbf72`, block 67148962
- USDC: `0x3600000000000000000000000000000000000000`; owner and fee recipient: deployer `0xe56357E6eFe146a33223Dd90f11bCA992C1B137C`
- Explorer: https://explorer.testnet.arc.io/address/0xd62B53a4d3a7Cc56467F75cdA8dA246eA2aB35ED

### Superseded and current (14 Oct 2026, later the same day)
- The first deployment (`0xd62B53a4…35ED`, block 67148962) is **superseded**. Circle's agent-wallet service cannot encode a struct argument
  (`can't pack ABI parameter`), so `settleEarly(id, offer, …)` cannot be called from an agent wallet. The contract gained `settleEarlyFlat`
  (same checks, flat arguments; 42 tests).
- **Current InvoiceBook: `0x108DA05Fec74a1c0620CF7D66D07AeB586A5288C`**, deploy tx `0x2d0204bca37f6c07420d02e8e5912a782b90a679cd00279b4a9516aeddad99ce`, block 67164103.
  https://explorer.testnet.arc.io/address/0x108DA05Fec74a1c0620CF7D66D07AeB586A5288C

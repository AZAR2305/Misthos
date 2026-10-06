---
title: Safety and limits
order: 6
summary: What the contract enforces no matter what any program says.
---

# Safety and limits

The InvoiceBook contract enforces these rules on-chain:

- **Signatures.** An invoice and every offer must be signed by the supplier's wallet. Contract wallets are supported.
- **Once.** An invoice is registered once and settled once. An offer can be used once.
- **Rate ceiling.** No early payment can carry a rate above 50%.
- **Caps.** The buyer's per-invoice and daily caps are checked on every payment.
- **Allowed token.** Only USDC is accepted.
- **Disputes.** A disputed invoice cannot be paid early.

## Known limits

- The contract is **unaudited** and runs on a test network. Do not use it with funds you cannot afford to lose.
- Numbers on the Live stats page come from chain events. Where a value does not exist yet, the page says so instead of guessing.

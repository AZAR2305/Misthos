---
title: What Misthos is
order: 1
summary: The idea in one minute, and who does what.
---

# What Misthos is

A supplier sends an invoice and the buyer approves it, but payment is due in a month. For that month the supplier is waiting on money that is already theirs. A buyer with idle cash could pay sooner and keep a small discount.

Misthos finds the fair price of that wait. Each business runs its own **agent**. The supplier's agent starts at **0%** and climbs a short ladder of signed offers. The buyer's agent accepts the first offer that beats its own private minimum. When the buyer has spare cash, that price is often **zero**.

A contract on **Arc** (Circle's blockchain) checks every signature and settles in USDC, once, in under a second.

## How one invoice is paid early

1. **Sign.** The supplier signs the invoice with their wallet.
2. **Register.** The InvoiceBook contract records it once. Duplicates are rejected.
3. **Approve.** The buyer approves the work. Only approved invoices can be paid early.
4. **Offer.** The supplier's agent posts signed offers, one rung at a time, starting at 0%.
5. **Pay early.** The buyer's agent accepts a rung. The contract pays the supplier and closes the invoice.

## Who does what

| | Supplier | Buyer |
|---|---|---|
| Creates | invoices | nothing, approves the supplier's |
| Signs | the invoice and each offer | the payment from their own wallet |
| Keeps private | what waiting costs them | their minimum rate and cash plan |
| Pays | nothing extra | the discount, plus a small success fee on it |

Everything public (invoices, the ledger, live stats) can be read by anyone, with no account.

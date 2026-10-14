---
title: Credit limits and the audit trail
order: 5.5
summary: How an agent decides how much to trust one business, why a deal can fail even when the cash is there, and how every decision can be checked.
---

# Credit limits and the audit trail

Having the cash to pay is not the same as being willing to take on more exposure to one business. Misthos keeps the two apart, and keeps a record you can check.

## Two ranges, one deal

Every early payment is a price between two private limits.

- **The supplier** has a highest rate it will sign. That rate comes from its own cost of waiting, with a safety margin, so it never signs for less than it is willing to take.
- **The buyer** has a lowest rate it will accept. That is the highest of three things: its **hurdle rate**, what its **cash can spare** (balance, less its reserve, less the payments it listed) and what its **credit limit** for that supplier still allows.

A deal exists only if the two ranges meet. If they do not, the agents stop and say so. Nothing is invented to make them agree, and nothing is paid.

Each side's range is private. You see your own on the invoice page, asked of your own agent, and never stored on the server. The other side only ever sees a signed offer and a short code for why it was accepted or declined.

## How a credit limit works

You set it on **Credit limits**. It limits one business at a time.

- A business you have not dealt with gets your **starting limit**. It starts at zero, so nobody is given credit until you decide.
- Each invoice that business **settles through Arc** raises its limit by a percentage you choose, up to your **maximum**.
- Only settlements with a transaction behind them count, each one once.

What counts as exposure depends on your side.

- **As a supplier**, it is what a buyer owes you across approved, unpaid invoices.
- **As a buyer**, it is what you have paid ahead of terms to one supplier whose invoices are not yet due.

A new commitment is allowed only if the new amount plus what is already outstanding stays within the limit.

### A worked example

A buyer sets a starting limit of 5,000 USDC, growth of 20% and a maximum of 20,000 USDC. With one supplier it has settled a 10,000 USDC invoice and a 4,000 USDC invoice, so settled volume is 14,000 USDC. The limit is 5,000 plus 20% of 14,000, which is **7,800 USDC**. One 4,000 USDC invoice was paid early for 3,900 USDC and is not yet due, so **3,900 USDC is outstanding**. A new early payment of 3,800 USDC fits, because 3,900 plus 3,800 is 7,700. A payment of 4,000 USDC does not, because 7,900 is over 7,800, even if the wallet holds far more.

### What does not count against anyone

- An **overdue** invoice is still owed, so it stays outstanding. It stops adding to the limit and carries no other penalty. It is not treated as fraud, and once it is paid it counts like any other.
- A **disputed** invoice is listed apart. It is never counted as a default and never adds to the limit.
- A settlement that cannot yet be proven, for example one the indexer has not read, does not raise a limit. If it is money you already paid ahead, it still counts as outstanding.

### When something cannot be read

If your agent cannot read your limit, its history or your payment calendar, it accepts nothing and waits for you. It never assumes a favourable answer. Every number on these pages says where it came from: **on-chain**, **policy** (your own setting) or **declared** (something you listed yourself, which can only lower what your agent pays, never raise it).

## Your payment calendar

List payroll and large bills on the buyer dashboard. Signed in, they are saved on your account, because your agent reads them there before it accepts any early payment. Kept only in a browser, your agent would not see them. The page tells you if any are saved only on your device.

## Link your agent

Your agent proves who it is by signing with its own wallet. To read your data it must be linked to your business, and that takes both halves: you make a one-time code on **Credit limits** while signed in, and your agent redeems it with a signature of its own. Nobody can link an agent they do not control, or attach yours to their business. A code works once and expires in minutes.

## The audit trail

Every decision an agent makes is written to a log that is chained, signed by the agent's wallet and checked by the server. For each decision it records the **policy version** it ran under and a **salted commitment** to the private numbers it used.

- Anyone can see the version, the code for the outcome and the on-chain records a credit check rested on.
- Nobody can see your hurdle, reserve, limits or balance. They are never in the log, and the server refuses an entry that contains one.
- You can prove a decision later. Your agent keeps the private inputs in its own files. Given those, anyone can replay the decision with the same code and must get the same answer, and can check that the commitments match.
- An accepted payment carries the hash of its decision on the settlement transaction, so the payment and the reasoning are tied together on Arc.

The model suggests. Code decides, and no model output can reach a signer or a contract call.

# Go to market and how Misthos earns (14 Oct 2026)

Honest premise: today the contract earns **10% of the discount** (`feeBps = 1000`, hard ceiling 30%, paid by the buyer on top, never taken from the supplier). At a
**0% rate the fee is zero**, so the headline result of the product is also the case that earns nothing. Any plan that depends on that fee alone is weak. This
document says so, shows the numbers, and proposes where the money really comes from.

## 1. What the fee earns today (arithmetic, not a forecast)
Discount = amount × yearly rate × days early ÷ 365. Fee = 10% of the discount.
| Invoice | Rate | Days early | Discount | Fee to us |
|---|---|---|---|---|
| 10,000 USDC | 12% | 30 | 98.63 | **9.86** |
| 10,000 USDC | 20% | 30 | 164.38 | **16.44** |
| 10,000 USDC | 0% | 30 | 0 | **0** |
| 25 USDC (our first real run) | 2% | 29 | 0.0411 | **0.0041** |
100 such invoices a month (1,000,000 USDC of face value) at 12% earn us about 986 USDC a month, which is **about 0.1% of volume**. The fee on the discount
alone is a thin, volume-dependent business. It is a fair, transparent base, not the main engine.

## 2. Who pays, and what they get (the value being sold)
| Customer | What they save or earn | What they will pay for |
|---|---|---|
| **Supplier** | Cash weeks earlier at a rate set by their own cost of waiting, often far below factoring (about 26 to 30% a year, [Fundthrough](https://www.fundthrough.com/blog/invoice-factoring/invoice-factoring-explained-costs-examples-faqs/), [Resolve Pay](https://resolvepay.com/blog/effective-annual-factoring-cost)) and 2/10 net 30 terms (about 37%) | A share of what they save versus the alternative |
| **Buyer** | Idle cash earns a return it did not have (discount), plus working-capital control and one place to see payables | A subscription for the treasury agent, because the saving is theirs |
| **Both** | A verifiable credit history that builds with every settlement (ERC-8004 plus the exposure limits) | Access to it |

## 3. Revenue streams, in the order I would build them
1. **Protocol fee on the discount (built).** 10% of the discount, on chain, cannot be raised above 30%. Keep it: it makes the contract self-funding and is easy to explain.
2. **Per-settlement minimum fee (small contract change).** A flat floor such as 0.10 to 0.25 USDC per settled invoice so the 0% case is not free to run. Cheap to add because settlement
   is already one transaction; it covers gas and monitoring. Disclose it plainly: the supplier still pays nothing.
3. **Buyer treasury agent subscription.** The buyer's agent saves its owner money (the discount) and the work of tracking payables. Price it as a fixed monthly fee or a share
   of the *savings the agent measured* (the decision log already records the discount earned and the hurdle). Align price with proven benefit.
4. **Hosted agents and relayer ("agents as a service").** Most small businesses will not run Node, a Circle login and a model key. A hosted version, the same open kit run for them, is the
   practical way to get past the first pilot. Charge per active agent per month.
5. **Reputation and credit data.** Settlement history, verified on chain, with ERC-8004 ratings per counterparty, is data a lender or supplier can underwrite against. Sell **read access**
   (API) to lenders and platforms, never private policy numbers. The decision log's salted commitments let a business prove its policy without revealing it.
6. **Funded early payment (later, and only with a partner).** When a buyer has no idle cash, a third party could fund the early payment and earn the spread, as supply-chain-finance platforms
   do. We would take a share of the funded flow. It needs licensing and capital, so it is a partnership for after the hackathon, not a feature to build now.

None of these has been tested with a paying customer. The market numbers I could find come from sellers' own websites. I found no published take rates for C2FO or Taulia, so I will not claim a benchmark.

## 4. How to get the first real users (traction is 30% of the score)
Build for **two-sided pairs that already trade**, because a pair needs no marketplace:
1. **One pair, this week.** A supplier you know and the buyer that owes them. The supplier's invoice, a 0% or low-rate early payment in test USDC. Use `docs/PILOT_GUIDE.md`. Log it in `docs/TRACTION.md`.
2. **Then buyer-led.** One buyer with many small suppliers is the highest-leverage unit: onboard the buyer once, and each supplier joins by a **claim link** with only a wallet. This is why claim links exist.
3. **Wedge messaging.** Suppliers: "get paid weeks early, priced by what waiting costs you, not by a factor's fee." Buyers: "turn idle cash into a return, with a limit and a cash floor the agent cannot break."
4. **Proof that travels.** Every settlement is a public transaction and a rating. Show the count, value, days gained and share cleared at 0% on `/stats`, labelled testnet and separated from team-run deals.
5. **Community channels first, no ad spend:** the Canteen and Arc builder communities, finance and SaaS founder groups, and the buyers who already pay late because of their own liquidity (the most common reason in the Atradius survey).

## 5. What to say to judges about money
- It is a real fee, on chain, disclosed, and capped; at 0% it is zero by design.
- The business model is value-based: share what the customer saves against factoring, plus subscription for the treasury agent and data access, not a larger cut of the discount.
- No customer has paid yet; the first pilot tests willingness to use it, not willingness to pay.

## 6. Decisions I need from the owner
1. Add a small flat minimum fee per settlement? (contract change and redeploy)
2. Subscription price or a share of measured savings for the buyer agent?
3. Which side do we recruit first: a buyer with many suppliers, or a supplier with one big buyer?

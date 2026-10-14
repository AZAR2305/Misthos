# Market research and recommended policy numbers (14 Oct 2026)

Purpose: replace guessed numbers with ones tied to what alternatives cost. **These are recommended starting points, not facts about your business.** The owners
of a supplier or buyer choose their own numbers; every figure below says where it comes from and how sure it is.

## What the research found
| Fact | Figure | Source | Confidence |
|---|---|---|---|
| A "2/10 net 30" early-pay discount, expressed as a yearly rate | about **37%** (36.7% on a 360-day year, 37.2% on 365) | [Tacto glossary](https://www.tacto.ai/en/procurement-glossary/2-10-net), [AI Accountant](https://aiaccountant.com/blog/vendor-early-payment-discount-automation) | High (arithmetic) |
| The same idea on longer terms (2/10 net 60) | about 14 to 15% a year | [Beancount.io guide](https://beancount.io/blog/2026/07/29/dynamic-discounting-c2fo-taulia-small-suppliers-guide) | Medium |
| Sliding-scale dynamic discounting is quoted as an annual rate prorated over days accelerated (example 12% a year, on net 60 paid 20 days early, about 1.33%) | 12% example | [Corpay](https://www.corpay.com/resources/blog/early-payment-discounts-dynamic-discounting) | Medium (illustrative) |
| Invoice factoring costs 1 to 5% of invoice value per month; industry average about 2.5% per 30 days, roughly **26 to 30% a year** | 26 to 30% | [Fundthrough](https://www.fundthrough.com/blog/invoice-factoring/invoice-factoring-explained-costs-examples-faqs/), [Resolve Pay](https://resolvepay.com/blog/effective-annual-factoring-cost), [eCapital](https://ecapital.com/blog/2022-invoice-factoring-rates-and-costs/) | Medium (sellers' own sites) |
| What idle cash can earn: 3-month US Treasury bill | 3.86% (week of 28 Aug 2026); 3.96% (24 Jul 2026) | [MarketXLS from FRED](https://marketxls.com/indicators/3-month-treasury-bill-rate), [Slickcharts](https://www.slickcharts.com/treasury/3-month) | High, but not current to 14 Oct |
| Average B2B payment terms | about 45 days; 43% of invoice value overdue; most common reason for paying late is the payer's own liquidity (45%) | Atradius 2025 survey, via [Kaplan](https://www.kaplancollectionagency.com/business-advice/54-statistics-on-the-b2b-payment-delays/) | Medium (secondhand) |
| Average time to be paid | about 53 days | Dun & Bradstreet, via [Pencil Pay](https://www.pencilpay.com/the-true-average-b2b-payment-cycle-in-2026/) | Low (year unverified) |

Not found: how much C2FO or Taulia actually charge, and any published exposure-limit benchmarks for small counterparties. The credit-limit numbers below are therefore
**risk heuristics, not researched benchmarks**.

## What this means for the numbers
The deal range is `[buyer hurdle, supplier ceiling]`. A deal exists only where those overlap, so the question is what each side's honest bounds are.

### Supplier
| Setting | Recommended | Reasoning |
|---|---|---|
| Cost of waiting (APR) | **18 to 26%**; use your real alternative: factoring about 26%, an overdraft or working-capital loan, or the late-payment cost | The value you get from being paid early is what you would otherwise pay to borrow. |
| Highest rate you will accept (ceiling) | **2,400 bps (24%)** | Stay below factoring (about 26%) or the product has no reason to exist, and far below the roughly 37% a 2/10 net 30 discount implies. The old placeholder of 50% was not defensible. |
| Starting rate | **0** | Start at no discount and let the buyer say no. The contract's own default and the 0% case depend on it. |
| Step between rungs | **400 bps** (six rungs from 0 to 2,000) | Few offers, fast negotiation. |
| Credit given to a new buyer (starting limit) | **small, 5 to 10% of your monthly sales** (or an amount you could lose without harm) | Heuristic. Unknown buyers default to zero in the code. |
| Maximum limit | **20 to 25% of monthly sales** | Heuristic. Concentration in one buyer is the real risk. |
| Growth | **10 to 20% of verified settled volume** (1,000 to 2,000 bps) | Credit grows only on settlements the chain confirms, each counted once. |

### Buyer
| Setting | Recommended | Reasoning |
|---|---|---|
| Hurdle rate (APR it must earn to pay early) | **0%** if the cash sits idle in a wallet that earns nothing; **about 4%** if it could instead be in T-bills (about 3.9% now); 6 to 8% if you want a risk premium | The hurdle is what the cash would otherwise earn. **A 0% hurdle is what produces the "cleared at 0%" result.** A buyer with a real alternative will not clear at 0%, and that is honest. |
| Liquidity floor | **next 30 days of obligations plus 10%** | The agent never spends below it. Your real payroll and bills decide it. |
| Per-invoice cap | **10 to 20% of free cash** | Limits one bad decision. |
| Daily cap | **25 to 30% of free cash** | Limits many small ones. |
| Human approval above | **10 to 20% of treasury** | Big payments go to a person. |
| Upcoming payments | **your real payroll, rent, bills** | Typed in on the buyer dashboard; marked "declared" because no chain can confirm them. |

### Why the idea still makes sense on these numbers
- Typical terms are about 45 days, so a supplier paid 30 days early at 12% gives up about 1% of the invoice. Factoring at the average would cost about 2.5% for the same 30 days.
- Where the buyer's hurdle is 4% and the supplier's cost of waiting is 20%, anything between 4% and 20% helps both sides; the contract settles at the supplier's signed price, the lowest rung the buyer accepts.

## What changes in this repo from the research
- The default supplier ceiling in `agent/.env` is reduced from 5,000 to 2,400 bps and the step is 400 bps. Everything else stays until you confirm it.
- No number above is claimed as measured. They are inputs, and the decision log records which version of them each decision used.

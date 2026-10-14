# Running a real pilot: how a second business joins

Why this exists: judges weigh **real use** (30%). Test USDC counts. Runs where one person controls both sides do not, and the stats page
labels them as team-operated. So the one thing that moves the score is **a different person or business with their own wallet and a real invoice**.
Nobody on the build side can be that counterparty. This guide is what you hand to them.

## Two kinds of pilot
| Type | What they have | What they do | Counts as |
|---|---|---|---|
| **(a) Browser wallet and test USDC** (about 15 minutes) | MetaMask, Rabby or Coinbase Wallet, and test USDC from the faucet | A real settlement on the live site (the steps below) | **pilot**, once `docs/TRACTION.md` holds a written independence note for them |
| **(b) Neither** | Real invoices and real cash figures, but no wallet | A **shadow report** at `/shadow` in their browser: what the agent would do with their invoices. Nothing is uploaded or stored | **shadow**: engagement, never on-chain traction. A wallet-free claim needs managed wallets (T10), which are not built yet |

Be plain with (b): a shadow report shows the value, it is not a settlement. Do not describe it as usage.

## What the counterparty needs for type (a) (about 15 minutes)
1. A browser wallet (MetaMask, Rabby or Coinbase Wallet) on **Arc Testnet** (chain 5042002, RPC `https://rpc.testnet.arc.io`, explorer
   `https://explorer.testnet.arc.io`, currency USDC). The site adds the network for them on the first "Switch" press.
2. Test USDC from https://faucet.circle.com (Arc Testnet). A supplier needs almost none (the server pays gas to register). A buyer needs
   enough to pay the invoices, plus a little for gas.
3. A real invoice: a real amount, a real due date and a real reason (a PO number or invoice reference). Test USDC, real relationship.

No email, Google account or password is involved. The wallet is the account.

## Two ways to pair
| Setup | Who | How |
|---|---|---|
| **A. You are the buyer, they are the supplier** (easiest) | The supplier is a friend or small business with a real invoice to you | They sign in with their wallet, choose **Supplier**, create the invoice. You approve it. You invite them with a **claim link**. They open it, sign, and you pay early. |
| **B. They are the buyer, you are the supplier** | A business that owes you | You create the invoice. They sign in, choose **Buyer**, approve it. |

Either way the two wallets must be **different people's wallets**. Do not run both sides yourself and call it a pilot.

## Steps (setup A)
1. **Supplier**: open the site, **Connect wallet**, **Sign in** (sign the message: no gas, no email), choose **Supplier**.
2. **Supplier**: **Credit limits** (`/supplier/policy`). Set the starting limit, maximum and growth for this counterparty. Leave blank to extend no credit.
3. **Supplier**: create an invoice: buyer's wallet address, amount, due date, reference. The Misthos server registers it and pays the gas.
4. **Buyer**: sign in, choose **Buyer**, set **Credit limits** and list real **Upcoming payments** (payroll, bills). Open the invoice, **Approve invoice**.
5. **Buyer**: on the invoice page, **Create claim link** at the rate you will pay (0% is valid), send the link to the supplier.
6. **Supplier**: open the link with the invoice's own wallet, sign. **Buyer**: **Pay**. Both sides see the settlement and the explorer link.
7. Optional, to let agents do the negotiating: each business runs its own agent (`docs/SETUP.md` sections 3 to 7c). That needs a Circle
   login per agent (an email per agent) and a model key. Not required for a first pilot.

## What counts, and what to record
Three origins, never added together: **pilot** (an independent business with a written note), **team** (wallets we control) and **unverified** (undocumented wallets). `/stats` shows pilot by default. Shadow reports are a fourth kind of thing and are not on `/stats` at all.

Write each real deal in `docs/TRACTION.md` as you go: date, who (a business name you can disclose, or "anonymous supplier"), face amount, rate
cleared, days early, transaction link. State plainly which wallets are independent of the team. Never include team-only test runs in the
traction answer; the two Arc settlements already on chain (25 and 40 USDC, 14 Oct) were run by the build team and are labelled that way.

## Numbers only the owners can choose (nobody should guess these)
Per business, set on the Credit limits page or in `agent/.env`:
- **Supplier**: cost of waiting (APR %), the highest rate it will accept, its starting rate (0 means "start at no discount"), the step between rungs, and its credit limit for each buyer (starting limit, maximum, growth per settled volume).
- **Buyer**: hurdle rate (APR % it must earn to pay early), liquidity floor (cash it never spends), per-invoice and daily caps, the size above which a human must approve, its credit limit for each supplier, and its real upcoming payments.
The agents refuse to act without these, by design, and the log records which version of the policy was in force for every decision.

## Safety notes for the pilot
- Unaudited contract, testnet only. Use test USDC only.
- Lose the wallet, lose the account: there is no recovery.
- Invoices and settlements are public on chain (address, amount, counterparty). Private policy numbers stay off chain; only salted commitments are public.

# Pilot outreach kit (16 Oct 2026)

Goal: get **independent** people to run a real invoice (or a shadow report) on https://misthos-kit.vercel.app. Send to as many real contacts as you can.
Each pilot counts only when the wallet is **theirs** and `docs/TRACTION.md` holds a written independence note (see `docs/PILOT_GUIDE.md`). Nobody on the team
fills in, creates or controls a pilot wallet. Wallet addresses are never typed in for someone else: they come from the person, in their own browser.

Live site is **wallet-only**: no hosted backend yet, so a settlement uses the on-chain path; accounts and claim links are local-only. Say this plainly if asked.

## Message A: a supplier or freelancer with a real invoice (settlement, about 15 min)
> Hi [name], I'm building Misthos Kit for the Tameion/Circle/Arc hackathon. It lets a supplier get paid early on an approved invoice, often at 0% discount, settled on a test network in under a second.
> Could you try it with a real invoice you have (test USDC only, no real money moves)? It takes about 15 minutes: you need a browser wallet (MetaMask, Rabby or Coinbase Wallet) and free test USDC from faucet.circle.com.
> Link: https://misthos-kit.vercel.app . I'll walk you through it on a call, or you can follow the steps I send.
> I'd like to say in my submission that you tried it. Are you okay with being named, or would you rather be "anonymous supplier"? Either is fine, and a "no" is fine too.

## Message B: a buyer who pays suppliers (settlement, about 15 min)
> Hi [name], I'm building Misthos Kit: an agent that decides which approved invoices to pay early with idle cash, only when it beats your own hurdle rate. Test network, test USDC only.
> Would you try paying one real invoice from your side? You need a browser wallet and test USDC from faucet.circle.com. About 15 minutes: https://misthos-kit.vercel.app
> I'd like to mention that you tried it. Named or anonymous, whichever you prefer. Fine to say no.

## Message C: anyone with real invoices but no wallet (shadow report, about 5 min)
> Hi [name], would you try a 5-minute check on your real invoices? https://misthos-kit.vercel.app/shadow runs in your browser: nothing is uploaded or stored and no money moves. You enter the cash you hold and your invoices, and it shows which ones an agent would pay early and what that would earn or save.
> Tell me honestly whether you'd use it and what would stop you. Okay if I quote you (named or anonymous)?

Shadow reports are engagement, **not** on-chain traction. Never count them as settlements.

## Step sheet to send after they say yes (settlement)
1. Install a browser wallet; add Arc Testnet (the site's **Switch** button does it): chain 5042002, RPC https://rpc.testnet.arc.io, explorer https://explorer.testnet.arc.io.
2. Get test USDC at https://faucet.circle.com (Arc Testnet).
3. Open the site, **Connect wallet**, sign in (no gas, no email), choose your side.
4. Follow `docs/PILOT_GUIDE.md` steps. Enter **your own** real amounts, due dates and references. Do not use anyone else's wallet.
5. Send me the explorer link and the sentence in the independence note below.

## Independence note to collect (their words, dated)
> "I am [name / business], not part of the Misthos team. The wallet 0x… is mine. I ran [one invoice / a shadow report] on [date]. You may quote me as [named / anonymous]."

Without this the activity stays `unverified`. Add the entry to `frontend/content/origins.json` and `docs/TRACTION.md` with the same date only after you have it.

## Tracker (fill in only real people and real replies)
| # | Contact (private) | Message | Sent | Reply | Yes/no | Wallet (from them) | Note collected | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |

Where to find real contacts today: classmates or family with a shop or freelance work, a supplier or client you already invoice, the hackathon Discord (post message A or B), local small businesses, student clubs that pay vendors.

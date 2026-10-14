# Pilot call script: 10 minutes, screen share

Status: **Path C** (no pilot has been confirmed yet, so this script covers both ways a pilot can go and says which to pick in the first two minutes). Fill in
`docs/PILOT_LOG.md` as you go. Do not smooth over anything that goes wrong; friction is the evidence.

Before the call, from this machine: run `pnpm --filter @misthos/agent doctor` and read every line. Have the live URL, the explorer open and `docs/PILOT_LOG.md` ready.

## 0:00 to 2:00  Who they are and which path
Ask, and write the answers in the log exactly as given (do not fill gaps):
1. What is the business, and are you a supplier, a buyer or both? Is there a real invoice between you and another business right now?
2. Do you have a browser wallet (MetaMask, Rabby, Coinbase Wallet) and can you add a network? Do you hold test USDC, or can you get some from https://faucet.circle.com in a few minutes?
3. May we quote you, and show your numbers anonymised, in the submission? Get a yes or no, in writing in the chat, with today's date.

Pick the path:
- **Path A, wallet and test USDC:** do the 8 minutes below as a real settlement on the live site.
- **Path B, no wallet:** do the **shadow report** (section B). It is a computation on their real invoices; it does not count as on-chain traction, and say so to them.
- **Not independent of us** (a friend on the team, a team-owned wallet): stop. It is a team run. Do it if it helps rehearsal, but log it as `team` and do not count it.

## Path A: a real settlement (2:00 to 9:00)
1. **Sign in** (1 min). Site, **Connect wallet**, **Sign in**, sign the message. Point out: no email, no password, no gas. Write down how long it took.
2. **Switch network** (1 min). If their wallet is on another network the site shows **Switch**. Note anything confusing.
3. **Choose a side** and open **Credit limits**. Ask them for their own numbers (starting limit, maximum, growth); do not suggest any. If they do not know, leave it blank: the app then extends no credit and says so.
4. **Supplier creates the invoice** (2 min): buyer's wallet address, real amount, real due date, a real reference. The server registers it and pays the gas.
5. **Buyer approves** (1 min), then **creates the claim link** at a rate the buyer chooses, ticking that they expect to pay that address.
6. **Supplier opens the link**, reads where the money goes, signs. (If this is the first payment to that address the buyer must confirm it. Let that happen; it is a feature.)
7. **Buyer pays** (1 min). If their agent wallet is a Circle wallet it may say **Activate your wallet** first: that is a one-time step, follow it as written.
8. Show the explorer link and the invoice page's negotiation trace.

If BACKEND_URL is set for their agent, run `pnpm --filter @misthos/agent applied-report` afterwards and read out which checks were on. If a check was not applied, **say so**.

## Path B: the shadow report (2:00 to 8:00)
1. Open **/shadow**. Say the first thing on the page out loud: *Shadow report: computation on your data. No funds moved.* Nothing leaves their browser.
2. Ask for three numbers they actually know: cash they hold, cash they always keep, what that cash would otherwise earn a year (0 if it sits idle). Do not offer defaults.
3. Paste or type their real invoices into the CSV box (counterparty, amount, due date, approved date, optional offer rate). **Show the format** if they ask. Fix any line the page rejects; it names the line.
4. Add their real payroll and bills.
5. **Compute.** Read the result with them: which invoices their agent would pay early, how many days that gains, what they would earn, and what a supplier would keep compared with factoring.
6. Ask: "If this were real, would you use it? What would stop you?" Write the answer down word for word.
7. Offer a real run later (Path A) or, once managed wallets exist, a wallet-free claim. Do not promise either.

## 9:00 to 10:00  Capture and thank
Use the checklist below. Ask if you may contact them again.

## Capture checklist (tick only what exists)
- [ ] Explorer link of each settlement (Path A), copied from the invoice page.
- [ ] A screenshot of the invoice page's negotiation trace, and of `/stats` showing the origin tab.
- [ ] The decision-log export for the run (`audit-decision`, `applied-report`) with the "NOT APPLIED" lines intact.
- [ ] A short quote, **with their written permission and today's date**, copied from their message, not from memory.
- [ ] The independence note for `docs/TRACTION.md`: who they are, that they are not on our team, that the wallet is theirs, and the date. Without it the activity stays `unverified`.
- [ ] `docs/PILOT_LOG.md` filled in: where they got stuck, how long each step took, what they asked for.
- [ ] For Path B: the exported report (CSV or Markdown), labelled shadow, kept separate from on-chain numbers.

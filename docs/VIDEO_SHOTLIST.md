# Demo video: 2:50 shot list

Limit: under 3:00. Record against the real thing, from a clean browser profile. **Show only what works today and label what it is.** The hosted site does not exist yet; until it does,
record from the local site and say "running locally" on screen. If no independent pilot settled, show the earlier settlements and put **"Team run: both agents are ours"** on screen over them.

## Before you record (run these and read the output; do not skip)
- `pnpm --filter @misthos/agent doctor` and read every line. Result must be all `ok` (model key included).
- `circle wallet status` in each login folder: both sessions valid (about 28 days on CLI 1.1.4 on 14 Oct; VERIFY it, it can change).
- `pnpm --filter @misthos/agent applied-report` if you will mention limits.
- The explorer open on the contract: https://explorer.testnet.arc.io/address/0x108DA05Fec74a1c0620CF7D66D07AeB586A5288C
- Two terminals ready: the supplier agent and the buyer agent (`BACKEND_URL` set if you will show the limits applied).

| Time | Shot | What to say (plain, no hype) | Must be true |
|---|---|---|---|
| 0:00 | Title card, then one number on screen | "A supplier that needs cash sooner pays factoring at about 26 to 30% a year, and the buyer often holds idle cash. Source on screen." | Cite one source from `docs/MARKET_RESEARCH.md` on screen |
| 0:20 | The two agent terminals side by side, then `circle wallet list --type agent --chain ARC-TESTNET` | "Two separate processes, each with its own Circle Agent Wallet. They share nothing." | The list shows both agent wallets |
| 0:45 | The live flow (screen recording): sign in with a wallet, the supplier signs an invoice, the relayer registers it, the buyer approves, the negotiation trace, settlement, the explorer link | "No email. The server pays gas. Each offer is signed, expires, and works once." | A real settlement happens on camera or is clearly labelled earlier |
| 1:50 | The 0% case, then an honest `NO_OVERLAP` (an invoice where the ranges do not meet) | "The buyer's cash was idle, so the price of waiting was zero. When the ranges do not overlap, the agents say so and nothing is paid." | Show the trace for each |
| 2:15 | `audit-decision` replay of one decision, the ledger/Beancount export, and a shadow report if one exists | "Every decision is logged with its policy version and replays to the same answer. The private numbers stay with the owner." | Do not show a private value |
| 2:40 | `/stats` with the Team runs tab selected and the empty pilot tab, then the repo | "These settlements are ours: team runs, labelled. Nobody outside the team has used it yet. Unaudited, testnet." | **Say it plainly.** |

## Things not to say
- Do not call the team runs traction or users, or say "customers".
- Do not say revenue exists. The fee is zero at 0%, and nobody has paid.
- Do not describe the shadow report as usage or as on-chain activity.
- Do not claim hosting, an audit, or a pilot that does not exist.
- Numbers on screen, in the README and on `/stats` must match: check them after recording.

## After recording
Re-run `pnpm --filter @misthos/agent doctor`, replay the README's links, and tick the checklist in `docs/SUBMISSION_CHECKLIST.md`.

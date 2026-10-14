# How to record the demo video, step by step (under 3:00)

This replaces guesswork in `docs/VIDEO_SHOTLIST.md` with exact steps. It uses only what works today. **Rule for the whole video: say what is real and what is ours.** Both settlements are team runs; never call them customers.

## 0. Tools (10 minutes)
- **Recorder:** OBS Studio (free) or the Windows Game Bar (press Win+Alt+R to start and stop; it records one window). 1920x1080, 30 fps. Record your voice with the same tool; use a headset mic in a quiet room.
- **Browser:** a fresh Edge or Chrome profile with no extensions and bookmarks hidden (so nothing personal shows). Zoom 100%. Dark or light theme, your choice, but keep it the same all video.
- **Terminal:** PowerShell, font size large (Ctrl + mouse wheel). Two windows side by side later.
- Close everything with private data: email, chat, the `agent/.env` file. **Never show `.env`, a key, or the Circle email code.**
- Write the narration below on a second screen or paper. Read it slowly; cut the video into the five parts (record each part separately, then join), so a mistake costs you one part, not everything.

## 1. Prepare (do this before you press record, 15 minutes)
Run each line in PowerShell from `C:\Users\thame\Misthos`.
1. `pnpm --filter @misthos/agent doctor` must show every line `ok`. If a line says `SESSION_EXPIRED` or `WALLET_NOT_ACTIVATED`, fix it first with the command it prints.
2. Rotate the Groq key first and put the new one in `agent/.env` (the old one was shown in chat).
3. Start the backend: `pnpm --filter @misthos/backend start` (wait for "listening"; open http://localhost:4000/api/health and check every field).
4. Start the website: `pnpm dev` (http://localhost:3000).
5. Start the two agents, each in its own terminal: `pnpm --filter @misthos/agent buyer` and `pnpm --filter @misthos/agent supplier`. Check http://localhost:4102/health and http://localhost:4101/health.
6. Make a fresh real invoice for the demo (this is a real transaction on Arc testnet, between our two agent wallets): `cd agent; pnpm exec tsx scripts/testnet-invoice.ts 40 45`. Copy the `INVOICE_ID=` it prints. Do this **before** recording so the video starts from an approved, unpaid invoice.
7. Have these tabs open: the site `http://localhost:3000/stats`, the explorer on the contract, and https://misthos-kit.vercel.app.
8. Rehearse the whole thing once without recording.

## 2. What to record, with the words to say
Times are targets. Keep each sentence short and plain.

### Part 1: the problem (0:00 to 0:20)
**On screen:** a title card (any slide) with one line and its source: "A supplier that needs cash early pays factoring at roughly 26 to 30% a year (Fundthrough, Resolve Pay). Buyers often hold idle cash."
**Say:** "Businesses pay each other late. A supplier who needs cash sooner pays about 26 to 30 percent a year to a factoring company. The buyer often has idle cash. Each side knows something the other does not: what waiting costs, and what the cash could earn. Misthos lets two agents find that price."

### Part 2: two agents, two real wallets (0:20 to 0:45)
**On screen:** two PowerShell windows side by side, one running the supplier agent and one the buyer agent (`[supplier-agent] listening`, `[buyer-agent] listening`). Then run: `cd agent; pnpm exec circle wallet list --chain ARC-TESTNET --type agent` in each login folder (use `$env:CIRCLE_CLI_HOME="C:/Users/thame/.misthos/circle-supplier"` first, then the buyer's). The addresses end `df6f` and `fa15`.
**Say:** "These are two separate programs. Each has its own Circle Agent Wallet, so neither holds a private key. They share nothing and talk only over the network." (Do not show the email you logged in with. Crop or blur it.)

### Part 3: the live flow (0:45 to 1:50)
**On screen, in order:**
1. Open `http://localhost:3000/invoices`. Click your new invoice (the id you copied). Show **Approved**, the amount (40 USDC), the due date.
2. Say: "This invoice was signed by the supplier's wallet, registered on Arc by a relayer that pays the gas, and approved by the buyer. It is a real transaction on the Arc testnet."
3. In a terminal start the negotiation: `curl -X POST http://localhost:4101/start/<INVOICE_ID> -H "content-type: application/json" -d "{}"`. (This is the same call the website's "Ask my agent to negotiate" button makes.)
4. Say while it runs: "The supplier agent's model proposes where to start. Code, not the model, builds the ladder and signs each offer. It starts at zero percent. Each offer is signed, expires, and works only once."
5. When it returns `accepted` at `rateBps: 0`, refresh the invoice page. Scroll to **Negotiation and decisions**. Point at the rung: "The buyer agent accepted the first rung. Its cash was idle, so it asked for nothing."
6. Click the settlement transaction link (opens the explorer). Show **Success**, the 40 USDC moving, and the block.
7. Say: "Paid early, in under a second, settled by the contract. The supplier received the full face value, no discount, no fee."

### Part 4: the zero case and an honest no (1:50 to 2:15)
**On screen:** the invoice trace again for the 0% result. Then show a case where the ranges do not meet. To make one: `pnpm exec tsx scripts/testnet-invoice.ts 80 45` (80 USDC is more than the buyer's spare cash), run the same `curl` on the new id, and show the result `hold_to_due` with the reason that every rung was refused for cash reasons. Open its invoice page and point at the "no deal" line.
**Say:** "When the buyer cannot or will not pay at any price the supplier would accept, the agents say so and nothing is paid. The invoice simply stays on its normal terms. That is the honest answer, not a failure."

### Part 5: proof and honesty (2:15 to 2:50)
**On screen:**
1. Terminal: `pnpm --filter @misthos/agent audit-decision <the decision hash>` (copy the hash from the trace). Show VERIFIED with the four checks. **Say:** "Every decision is logged with the policy version it ran under. The owner can replay it from their own files and get the same answer. The private numbers stay with the owner."
2. Open https://misthos-kit.vercel.app/stats. Click **Independent pilots (0)** then **Team runs (2)**. **Say:** "This is the part that matters. These two settlements are ours: both agents are run by us. Nobody outside the team has used it yet, so the independent pilots tab is empty on purpose."
3. Last 5 seconds: the repo name on screen. **Say:** "Unaudited, testnet only. The code is open."

## 3. Do not say, do not show
- Do not say "customers", "users", "traction", "revenue", or "live in production". Say "team run", "testnet", "we have not had an independent pilot yet".
- Do not show: `agent/.env`, `backend/.env`, any key, a login email, or a code from Circle.
- Do not show the shadow report as usage; if you show it, say "this is a computation on numbers you type, no money moves".
- Do not claim the backend is hosted. The website is live; the backend and agents run on this machine in the video.

## 4. After recording
- Watch it once at normal speed. Check no secret appeared. Check every number you said matches the screen.
- Trim to under 3:00. Export MP4, 1080p. Upload as unlisted (YouTube) or the form's own uploader.
- Run `pnpm --filter @misthos/agent doctor` again and keep the output for the submission.
- Tick the lines in `docs/SUBMISSION_CHECKLIST.md` that this video makes true (rows 2 and 10), and no others.

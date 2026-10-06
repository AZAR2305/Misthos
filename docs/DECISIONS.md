# Decisions

Format: date, decision, reason. `VERIFY:` marks anything unconfirmed.

## 2026-10-05 landing page and 3D agents

**Landing structure follows the reference recording, restyled.** The reference is the "REWARDER" Web3 landing
page by Extej (Dribbble shot 26109429), seen in `docs/reference/Screen Recording 2026-10-05 193420.mp4`. We use its structure and
interaction pattern only: a crystal field that rises from the floor, bursts to the edges on first scroll,
condenses into a ring, a scroll-pinned horizontal word carousel with a `n / N` counter, a central 3D mark, and a
closing call to action. We did not reuse its brand name, copy, colours, shard model or Ethereum diamond. See
`docs/inspiration-notes.md`.

**Palette is the Arc theme from the spec, not the reference's green.** Cello 950 canvas, Sail for crystals,
money and primary actions, Bossanova only for agent voice (the supplier agent body, agent bubbles, a few accent
shards). `frontend/design/tokens.css` is spec 10.2 verbatim. The three.js scene cannot read CSS variables per frame, so
`shards.ts` and `ShardScene.tsx` carry the same hex values. VERIFY: the three source hex values were
auto-extracted by Brandfetch from arc.network and are unclaimed (spec 10.1); check against arc.io in a browser.

**The 3D mark is our own placeholder, not Arc's logo.** The central mark and the nav glyph are an original
arch ("arc") with an inner curve and a travelling point (the discount curve and the settlement). The official Arc
vector was not provided and the spec says not to copy proprietary brand assets. Replace `ArcGlyph` (Nav.tsx) and
`archMarkGeometry` (shards.ts) with the official mark once it is available and its usage is confirmed.

**Deviations from the spec's "quiet" principles, on the landing page only.** The spec (10.6) asks for one bold
element and no decorative washes, and for sentence-case headings. The product owner asked for a bold, template-like
3D landing page, so the landing page uses uppercase display headings and a full-screen 3D scene. The app pages
(P0 and later) still follow 10.6. Colour roles are unchanged. Display face is Chakra Petch (free, OFL), used only
for the landing and the 404-style placeholder. Body is DM Sans and mono is JetBrains Mono as specified.

**Fonts via @fontsource, not next/font/google.** The spec says next/font/google (self-hosted at build). On this
machine Node cannot reach some hosts over IPv6, so a Google Fonts fetch at build time can fail. `@fontsource/*`
ships the same fonts through npm. Family names match tokens.css ("DM Sans", "JetBrains Mono"). VERIFY on Day 1: the
5-minute check of Arc's own font on arc.io (spec 10.4) is still open.

**Dependencies added (one-line reasons, per spec 0.2).**
- three, @react-three/fiber, @react-three/drei, @react-three/postprocessing, postprocessing: the 3D scene and bloom.
- lenis: smooth scrolling that the scroll-driven scene reads from. Disabled under prefers-reduced-motion.
- playwright-core: screenshots at 375/768/1280 using the installed Edge (no browser download).
- @fontsource/*: see above.

**Agent models.** The two agents on the stage use `RobotExpressive.glb`, a CC0 character by Tomás Laulhé
(Quaternius), with face morph targets by Don McCurdy, copied from the three.js examples repo
(`examples/models/gltf/RobotExpressive`). We recolour its "Main" material (supplier: Bossanova 500, buyer: Sail 400),
use its Idle, Wave, Yes, No, ThumbsUp and Jump clips, drive its Angry, Surprised and Sad morphs, and add a floating
invoice (supplier) and a coin stack (buyer). We did not pull assets from hackathon winners' repos or from licensed
marketplaces: their licences were not verified, and the spec asks us not to copy proprietary assets. Other CC0
sources if a different look is wanted: Quaternius packs on poly.pizza, Kenney, Khronos glTF sample assets.
Colour mapping is a judgment call: both agents are "agent voice" (Bossanova) in the spec, but the buyer holds the
treasury (Sail = money), so the buyer body is Sail and the supplier body is Bossanova.

**The stage is an illustration, not a simulation.** Buttons post a signed offer, reject with the real reason code
`BELOW_HURDLE`, and accept. No rates, amounts or hurdle values are shown, the stage carries the label
"Illustration of the protocol's roles and reason codes. No live data.", and it never calls an API. When real
negotiations exist, drive the same poses from `GET /api/invoices/:id/messages` (spec P8) instead.

**Hero curve is an honest empty state.** Spec P1 wants a live mini discount curve from the latest real settlement.
There is no backend, so `src/lib/settlement.ts` returns `unavailable` and the hero draws a dashed empty arc with
"Unavailable. The stats API is not connected yet." Wire it to `GET /api/stats` when it exists.

**Evidence figures.** QuickBooks 2026 Small Business Late Payments Report: 59% overdue 30+ days (up from 47%),
$17.7K owed on average. Xero Small Business Insights: 29.3-day average wait in the June 2026 quarter, up from 28.6
in March. Both verified against the public pages on 5 Oct 2026. The spec also says "payments almost nine days late,
about a day worse than Q4 2025"; the Xero page we found says late-payment time improved slightly to 8.5 days, so we
left that line out. VERIFY before it goes in the README or the video.

**Placeholders that must not ship as facts.** `/app` is a placeholder page. The proof row shows "Unavailable: not
deployed yet" for InvoiceBook and "Unavailable: not published yet" for the repo (`REPO_URL` in Final.tsx).
The USDC address shown is the spec's Arc testnet value (`0x3600…0000`).

**Performance and accessibility choices.** About 1,000 instanced shards (half on screens under 768px wide), one
draw call per shard type, positions interpolated from precomputed formations. The page renders and scrolls without
WebGL (the canvas is simply absent). `prefers-reduced-motion` freezes time-based motion and disables smooth scroll.
The agent canvas stops rendering when off screen. Pointer-follow light only starts after the first pointer move.
Tested in software GL only (about 1.5 fps in the screenshot browser); VERIFY the frame rate on a real GPU and on a
mid-range phone.

**Machine quirk.** Node's `getaddrinfo` returns only an IPv6 address for registry.npmjs.org here and IPv6 is
unreachable, so npm, pnpm and Node fetch time out while curl works. `C:/Users/thame/.node-shims/ipv4.js` forces
IPv4 lookups; use it through `NODE_OPTIONS=--require ...`. It lives outside the repo on purpose.

**MCP servers for frontend work** are declared in `.mcp.json` (project scope): Playwright (browser screenshots
and interaction), Context7 (current library docs) and the shadcn registry server. They load on the next Claude Code
session start and need approval the first time. The three packages exist on npm (@playwright/mcp, @upstash/context7-mcp,
shadcn); they have not been launched through Claude Code yet. Each entry sets `NODE_OPTIONS` to the IPv4 shim above
(path is machine-specific; drop it on a machine without the DNS problem).

## 2026-10-06 restructure, contract, agents, backend

**Repo layout is four folders, not the spec's apps/packages tree.** `frontend/` (Next.js, was apps/web, tokens moved to
`frontend/design/`), `backend/` (Postgres schema, API and indexer later), `agent/` (core library, protocol, wallets,
the two agent processes) and `contract/` (Foundry). The spec's `packages/core|wallets|protocol|agents|mcp` map to
`agent/src/core|wallets|protocol|agents` (MCP not built yet). `docs/` stays at the root. The 17 MB reference video and
the Foundry `lib/` are gitignored; restore `lib/` with the command in `contract/README.md`.

**Render performance (measured, Intel UHD, uncapped, headless Edge).** Post-processing was about 90% of the frame cost.
MSAA halved the frame rate and half-float buffers cost about 60% more. The composer now uses 8-bit buffers, no MSAA,
and SMAA at the top tier only; bloom runs at half resolution; the clearcoat layer and two lights were removed.
Top tier went from about 38-48 fps to about 100 fps; lower tiers run 140-200 fps. `PerformanceMonitor` steps quality
down on slow machines; `?q=0|1|2` pins a tier and `?post=0` disables post-processing, for testing.

**Contract.**
- `evm_version = cancun` because OpenZeppelin 5.7 uses MCOPY. VERIFY: Arc testnet supports Cancun before the first
  deploy (a dry run against the live chain simulated fine, which does not prove opcode support on the real network).
- The success fee counts toward the per-invoice and daily caps (spec 7.4 step 5: caps on net + fee). A zero fee
  recipient means no fee, and then the fee is also not counted.
- `tokenAllowed` is a mapping with an owner-only `setTokenAllowed` (EURC stretch) instead of a single constant, and
  `domainSeparator()`, `hashInvoice` and `hashOffer` are exposed for off-chain signers and tests.
- `settleBatch` is built now (the starter message asks for it on Day 1) even though auctions are Tier 3.
- Arc mainnet chain id 5042 comes from docs.arc.io; the deploy script refuses it without `CONFIRM_MAINNET=1`.
- The Foundry tests use a 6-decimal `TestUSDC` and ERC-1271 test wallets. They are unit-test fixtures only.
- A testnet deployer key was generated with `cast wallet new` into `contract/.env` (gitignored). Address:
  `0xe56357E6eFe146a33223Dd90f11bCA992C1B137C`. It holds no funds yet: fund it at faucet.circle.com before deploying.
  The private key is only in that file. A real deploy costs about 0.13 USDC.

**Agents.**
- Ladder: spec 8.2 says start, start + step, ... up to the ceiling and also "3 to 6 rungs". With the default 0 to 2000 bps
  and 200 bps steps that is 11 rungs, so when it would exceed 6 the step is widened so the ladder ends at the ceiling in
  at most 6 rungs (0, 400, 800, 1200, 1600, 2000).
- Allocator vs Appendix B: spec 8.3 subtracts the face of every unselected invoice that falls due from the cash path, but
  Appendix B's fixture ("cash above floor 7,000", four invoices totalling 10,700) is only consistent if payables are not
  on the path. Default follows 8.3; `includeUnselectedDue: false` reproduces the fixture. A payroll test covers the
  obligation case. Resolve with whoever owns the spec before shipping the buyer page.
- Message signatures: 8.6 says "signed with EIP-712" without types. Accept, reject and withdraw sign
  `MisthosMessage(kind, invoiceId, rung, ref, from, ts)` in the Misthos domain; an offer is authenticated by its
  `EarlyPayOffer` signature, the one the contract verifies.
- `CircleCliAdapter` flags come from the installed `@circle-fin/cli` 1.1.4 `--help` output (`wallet sign typed-data`,
  `wallet execute "fn(types)" args --contract --address --chain`, `wallet list --type agent`, `wallet status`, login with
  `--init` and `--request --otp`). It runs the CLI's JS entry with Node so JSON arguments never go through a shell.
  VERIFY once logged in: the JSON shape of sign and execute results (we search for a signature and a hash instead of
  assuming field names) and tuple argument encoding (passed as JSON). Execute may return only a transaction id; so
  `ExecuteResult.txHash` is optional and the backend indexer is the source of truth for hashes.
- The Circle CLI refuses to run until its Terms of Use are accepted. We do not accept legal terms for the user and do not
  set `CIRCLE_ACCEPT_TERMS`. `pnpm doctor` reports this as `TERMS_NOT_ACCEPTED` with the fix. Login (email OTP) is also
  the user's step.
- `CircleManagedAdapter` (managed wallets for real suppliers) is not built: it needs a Circle API key and entity secret.
- The decision log is process-local for now (`DecisionStore`, hash-chained and verifiable); the backend will persist it.
- Tests use a key-backed wallet, a recording `execute` and a scripted model as stand-ins for a Circle login, the chain and
  an API key. They live in `agent/test` and are not importable from `src`. The real-chain run is `e2e:testnet` (to build).
- vitest runs in a single forked process (`pool: forks`): the thread pool ran out of memory on this machine.

**Backend.** `backend/db/schema.sql` is spec section 6 and is applied and constraint-tested against PGlite (Postgres in
WASM). `gen_random_uuid()` is built in, so no `pgcrypto`. The API routes, indexer and job outbox are not built yet.

## 2026-10-06 app pages, themes and agent motion

**App without a backend.** The pages read the chain directly: one shared, polled view of every InvoiceBook event (range-split
`getLogs`), folded into invoice records in the browser. People sign with a browser wallet (EIP-6963 discovery, network switch
to Arc). The spec says a browser wallet is "not required" because Circle wallets sign; it is still supported because an EOA
signature is exactly as valid to the contract, and it makes the whole flow usable and testable today. References and notes the
chain does not hold stay in browser storage on the device that typed them. Registration is sent from the supplier's own wallet
(the spec's gasless relayer needs the backend). A supplier hands a buyer a signed offer code (EIP-712 EarlyPayOffer plus its
signature); only that invoice's buyer can use it, once, before it expires, never above its rate.

**Real end-to-end test.** `pnpm --filter @misthos/frontend e2e:local` starts Anvil, deploys the real contract, builds the app
against it and drives the real UI with a browser-wallet stand-in that forwards to Anvil's unlocked accounts. It checks the
chain after each step: net + discount = face, fee = 10% of the discount, the supplier received exactly net, the buyer paid
net + fee. It found and fixed a crash (fractional seconds passed to BigInt in the discount curve).

**Agents are bound to localhost and CORS-limited.** The buyer agent holds a private hurdle, so both agents listen on
127.0.0.1 and answer CORS only for AGENT_ALLOWED_ORIGINS. CORS is not authentication; any local process can still call them.

**Themes (product owner: "not everything green", "better colour grading", try a white page with glossy violet).** Four themes
rendered side by side on the landing page, the 3D agents and the real app pages (`scripts/themes.mjs`, `e2e:local` with
`E2E_THEMES=1`). Each pairs a cool world with a warm action and warm or contrasting characters:

| Theme | World | Action | Agents | Verdict |
|---|---|---|---|---|
| Violet night (default) | near-black, glossy violet crystals | lime | coral and ice | Most distinctive; the agents pop; strong on every screen |
| Daylight violet | white page, black text, glossy violet glass | black pill, violet highlights | pink and teal | Best for dense data and the app; the owner's idea; clean and professional |
| Midnight coral | deep navy, icy aqua crystals | coral | coral and aqua | Strong and trustworthy; crystals read icy rather than shiny |
| Emerald night | black, emerald | mint | emerald and mint | Flat: one hue everywhere, the agents melt into the world |

Recommendation: Violet night as the default and Daylight violet as the light option; keep the other two in the picker. The
choice is saved per browser (`?theme=` overrides it). All 15 key text, accent, status and UI pairs meet WCAG targets in every
theme (`pnpm --filter @misthos/frontend contrast`; the light theme's "ok" green was darkened from 4.03:1). CSS lives in
`design/themes.css` (tokens.css stays as the spec); the three.js palettes live in `src/lib/themes.ts` and must stay in step.
This replaces the earlier "green on black" request and moves away from the spec's Sail/Cello/Bossanova palette, which was an
unverified Brandfetch extraction anyway (VERIFY against arc.io).

**Agents move like characters.** Same CC0 RobotExpressive model, now with: autonomous idle gestures every few seconds, head
tracking toward the cursor (only if the clips animate the head bone, so offsets cannot accumulate), walking to meet at the
middle to hand over an offer, a thumbs up and a jump on accept, a dance on settlement, contact shadows, and per-theme skins
(eyes glow in the action colour). Still labelled as an illustration with no numbers.

## App shell: header-led, wallet gate, role choice (6 Oct 2026)
- The left rail is replaced by a sticky glass header: brand, role-aware tabs with a sliding underline, network pill, a Supplier/Buyer switch, theme picker and the wallet control. The header tightens on scroll. Phones get the tabs as a second, scrollable row. Kit and GitHub links moved to a footer.
- `/app` is now three states: no wallet shows the connect gate (headline, wallet cards for the wallets found in the browser or install links, three steps); a connected wallet with no side chosen shows the Supplier/Buyer choice; after that it is a short overview with the live setup checks. Pages that act for a person show a smaller version of the gate instead of an empty state.
- The side is remembered per wallet address in localStorage (`misthos.roles.v1`, replacing the single global `misthos.role.v1`). Visiting a /supplier or /buyer page sets the side to match. It is a convenience for what the header shows; it grants nothing, and the contract still decides who may do what.
- Floating crystals on the gate are CSS shapes, not WebGL, so the app pages stay light. Entrance and hover motion is CSS only and is switched off under prefers-reduced-motion.
- `--role-supplier` and `--role-buyer` are new theme variables (same hues as the agents on the landing page).
- VERIFY: Magic Patterns was used for layout ideas only; nothing was copied from its output.

## Landing rebuilt from the Locomotive recording; mint theme from a Lovable template (7 Oct 2026)
- **Layout reference:** `docs/reference/Recording 2026-10-06 192725.mp4` (10 s): lisa.locomotive.ca, a light grey studio, one large 3D
  character, a minimal header (wordmark left, mark centre, one link right), big plain type, and an assistant that says short lines
  after "[click] to start". We took the pattern only: no Locomotive name, copy, character or assets. The hero is now one agent
  (CC0 RobotExpressive, bare, full body) on a studio gradient; click starts a five-line tour (typed text, a pose per line, the
  agent changes side colour when it talks about buyers). Nothing plays before the first click; reduced motion turns off typing and
  auto-advance. The crystal field, the pinned horizontal carousel, Lenis smooth scroll and the post-processing stack were removed;
  the rest of the page is plain ruled rows.
- **Colours and type:** the product owner asked for the look of the Lovable "Team Directory" template
  (https://team-directory-template.lovable.app). Its published stylesheet defines a mint primary (oklch 82.34% .1385 148.16 =
  #82de91) on stone neutrals, Figtree, and a dark mode that follows the system setting. We converted those tokens to hex in
  `design/themes.css` as two themes, `mint` (default, light) and `mint-dark` (chosen automatically when the system is dark and no
  choice is saved). The four earlier themes were removed. Fonts: Figtree via `@fontsource/figtree`.
- **Deviations from CLAUDE.md:** (1) "green = status only": the template's primary is green, so the primary fill and links are
  mint/green; status "ok" is a different, darker green and always has a word or mark. Agents stay violet. (2) Spec 10.2 fonts
  (Chakra Petch/Circular) replaced by Figtree. VERIFY with the product owner if Arc branding must come back.
- All 15 contrast pairs pass in both themes (`pnpm contrast`); `pnpm e2e:local` passes with the new theme.

## Accounts: Google identity bound to a wallet and a side (7 Oct 2026)
- **Question from the product owner:** should buyers and suppliers sign in with Google and link an Arc wallet address? **Yes, as
  an identity layer, not a replacement for the wallet.** Google proves who someone is (real email, recovery, notifications,
  one account per business). The wallet signs everything binding, so the contract still enforces by signature and a stolen
  Google session alone cannot move money. Binding is proven by a signed one-time message (no gas); one Google identity maps to
  one address and the reverse (both unique); each account has one side, switchable with an explicit confirm.
- **Public pages stay public.** Reads never need an account. Acting as a supplier or buyer does when the app has a server
  (`NEXT_PUBLIC_API_URL` set). Without a server the app keeps working on a wallet alone with the side stored on the device.
  That is a deliberate mode, not a fallback for failures: a server that is configured but down shows "unavailable".
- **Server-side checks only.** The ID token is verified in the backend (signature, issuer, audience, expiry, verified email).
  Sessions are opaque HttpOnly cookies, SHA-256 stored, with an Origin check on writes.
- **Not done / VERIFY:** no Circle user-controlled (social-login) wallets yet (VERIFY Arc support and a Circle API key); the
  relayer is a throwaway key, not a Circle managed wallet; no rate limiting on /api/auth/*; ERC-1271 wallet signatures are
  coded but untested on Arc; obligations, policy and supplier preferences exist as API endpoints but the UI still keeps them
  on the device.

## Agents as real 3D characters, in-app docs, production pass (7 Oct 2026)
- **Model.** The agents are the CC0 "RobotExpressive" GLB (Tomas Laulhe / Quaternius, three.js examples), a Blender-made rigged
  model with 14 clips and face morphs. No geometry is generated in code except small props (invoice, coin stack, desk).
  Michelle, Xbot and Soldier were evaluated and rejected: they are Mixamo characters, and redistributing them in a public repo is
  a licence grey area (VERIFY). Swapping the model is one constant (`MODEL_URL` in AgentStage.tsx) plus bone names.
  Blender 4.2 (portable) was downloaded to `~/tools` and not needed in the end: poses were authored and checked in three.js.
- **Motion layers** added on top of the clips: typing posture (arms to a standing desk that rises from the floor, head tips down,
  eyes flicker), breathing, soft shadow maps, clearcoat plastic. Head and body follow the cursor; one-shot clips cross-fade.
- **Where agents appear.** Landing hero (guided tour), the Agents showcase (two agents and a terminal that plays a negotiation:
  "climb a rung" or "accepted at 0%", rungs and reason codes only, no amounts, labelled as an illustration), the /agents page, and
  a docked companion on every desktop app page that reacts to transactions through `lib/agent-bus.ts`.
- **Header.** Primary pages for the chosen side plus a More menu for every public page; the wallet's USDC balance is a chip in the
  header and a card on Overview. The network badge moved to the footer.
- **Docs.** `frontend/content/docs/*.md` are rendered in the app at /docs. UI text no longer points at repository files.
- **Production.** Metadata and share image, sitemap, robots, manifest, 404 and error pages, security headers, model caching.
  Agent URLs default to empty in production so a visitor's browser never probes localhost. VERIFY before launch: set
  `NEXT_PUBLIC_SITE_URL`, and no CSP is set yet (wallet, Google sign-in and three.js need a tuned policy).

## Sign-in hardening, claim links, judge tour (7 Oct 2026)
- **Google token replay.** A signed ID token is valid for an hour, so a captured one could be replayed. Sign-in now needs a one-time server nonce that Google embeds in the token; a token without a nonce we issued, or one already used, is refused. Verified in tests (replay, missing, expired).
- **Wallet message.** The one-time message a wallet signs names the requesting site, so a signature gathered on a look-alike site is not valid here. `/api/auth/*` and `/api/claims/*` are rate limited (in memory, one process; also limit at the proxy; `TRUST_PROXY` for X-Forwarded-For).
- **Wrong wallet.** With accounts on, signing and paying are blocked unless the connected wallet is the one linked to the account (`useSignerCheck`), not just warned about.
- **Relayer in the UI.** A signed-in supplier's invoice is registered by the server, which pays the fee (the end-to-end test checks the registration tx was sent by the relayer). If the deployment has no relayer the wallet pays, as before. Real failures never fall back silently.
- **Claim links (spec 8.15).** Buyer creates a standing offer for an approved invoice; the link is a 128-bit bearer token (only its SHA-256 is stored, shown once). The supplier needs no account: the page shows the terms and the payout address, which is the invoice's own supplier wallet fixed on-chain, and only that wallet's signature is accepted, so a forwarded link cannot redirect money. One claim wins atomically. Nothing is paid until the buyer reviews and settles with the stored signature. End-to-end test: cleared at 0%, EarlySettled on a real local chain. Not done from 8.15: first-payment-to-a-new-address human confirmation (every payment is a human click in the UI today) and email-created managed wallets (needs a Circle API key).
- **UI.** Provenance labels are pills (On-chain, Agent), not braces. The agent companion shows only on the home pages and when something happens. New `/judge` page with a click-in-order tour, live figures and an honest built / pending / not-built list. `docs/HACKATHON_SCOPE.md` compares the project with what Tameion asked.

## Agent core, light/dark toggle, fonts, cleaner UI (6 Oct 2026)
- **Agent model.** The cartoon robot and the human/android GLBs are gone. Each agent is now an abstract "agent core" built
  in code (three.js primitives, no model file): a dark glass shell with a visor and two eyes, gyro rings, an antenna node and,
  when it stands alone, USDC-style coins in orbit. It floats, follows the cursor, nods, shakes, hops and spins, walks (glides)
  between positions and shows faces through the eyes (angry, surprised, sad). It takes the theme colours (mint = supplier,
  violet = buyer). Rationale: a person or a toy robot does not say "payments agent"; a coin-and-ring object does.
- **Head spin (historical).** Procedural bone offsets used to pile up each frame; no bones are driven any more.
- **Theme.** The Theme menu is now one light/dark switch (sun/moon). Stored choice, `?theme=` and the system setting still apply.
- **Fonts.** Bricolage Grotesque for headings, Plus Jakarta Sans for text (both via `@fontsource`, no network at build).
- **Nav.** Docs is a tab of its own; "More" only appears once a side is chosen and holds the other public pages.
- **Removed from the UI.** The "contract not live" banner, the Judge tour and Developer kit pages, and the terminal commands
  that were shown to visitors (they point at the Docs instead).

## Agent review fixes (6 Oct 2026)
- **Liquidity on accept.** `BuyerAgent` needs a `treasury()` source. Every offer is checked with `fitsCashPath` (not the optimiser, whose tie-break would drop a 0% offer) against the real USDC balance, the buyer's calendar and the daily cap before it is accepted. The runner supplies the wallet balance and, until the backend feeds it, an empty calendar, so only the floor and cap apply there. VERIFY: wire the calendar from `/api/obligations`.
- **Idempotent `/negotiate`.** Replies are cached in process by (invoice, rung, nonce). The cache is lost on restart; the settle idempotency key and the on-chain nonce still prevent a second payment.
- **Control routes.** Local callers, or a remote caller with `AGENT_CONTROL_TOKEN`. Only `/health` and `/negotiate` are open.
- **Hero and agent look.** The orbiting rings are gone; the agent is light green in dark mode and four USDC-blue coins spin around it. VERIFY: coin art is a blue disc with a white dollar mark drawn in code, not Circle's official asset (the share link could not be opened from here).
- Full agent-versus-spec table: `docs/SPEC_COMPLIANCE.md`.

## Theme choice (6 Oct 2026, product owner)
- Kept Mint (light) and Mint dark; the Arc-palette options (Arc light, Arc dark, Arc midnight) were tried and removed. The Arc palette in the spec (Cello, Sail, Bossanova) is still in `frontend/design/tokens.css` as the spec's source colours. arc.network could not be opened from the build machine, so the palette was never checked against the live site.
- The two agents are told apart by colour: supplier green, buyer pink-violet (shell, eyes, band, ring colour on the stage).
- The agent is interactive: it follows the cursor, perks up and widens its eyes on hover, reacts with a different gesture on each click, and can be dragged round to spin it (it settles back). USDC coins spin on their own axes while orbiting at a distance.

## Signed decision log, no localhost defaults, Agent log page (6 Oct 2026)
- **Log pipeline.** Agent: JSON-lines file in `AGENT_DATA_DIR`, verified on load; entries signed by the agent wallet in the background and delivered to `BACKEND_URL`; signing and delivery never block a decision. API: `AGENT_WALLETS` lists the accepted signers; ingest checks hash, signature and chain position; verify re-checks everything stored. Entries from the two agents are separate chains (one per signer), not one global chain.
- **No localhost in code.** Frontend: no default for agent addresses, site URL or API (unset means "not configured" and the page says so). Backend: `FRONTEND_ORIGINS` has no default. Agent: no default for the other agent's address or the allowed browser origins. The agents still bind to 127.0.0.1 so they are not exposed by accident; that is a safe bind, not an address anything connects to. Setup docs and READMEs still show local addresses for running on a laptop.
- **Agent page.** It showed two cards probing an agent address on the visitor's own machine, which is useless to anyone else. It is now the public Agent log: verification of each agent's chain and signatures, every decision with its hash, and a link to the settlement transaction that carries that hash. The tab is named "Agent log". Owners still see their own agent's status on their dashboard.
- **Dashboards.** The invoice table has a "Proof on Arc" column (the latest on-chain event and its transaction link); the two dashboards share one column grid and spacing.

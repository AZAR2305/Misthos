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

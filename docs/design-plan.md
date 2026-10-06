# Design plan (spec 10.6, pass 1)

Scope so far: the landing page (P1) and the 3D agents. App pages are not designed yet.

## Palette
From spec 10.1 and `frontend/design/tokens.css`. Cello 950/900 canvas. Sail 300 = money, primary actions, focus ring and the
crystals' highlights. Bossanova = agent voice only (agent bubbles, the supplier agent, a few accent shards).
Status colours are used for status only (the "Settled on Arc" line on the stage is `--color-ok`).

## Type
Display: Chakra Petch 500, uppercase, tight leading, for the landing headlines (decision recorded). Body: DM Sans.
Mono: JetBrains Mono for counters (`1 / 5`, `//01`), provenance tags (`{on-chain}`, `{testnet}`, `{agent}`) and the
agent bubbles. Numbers are tabular.

## Layout concept, one sentence per section
- Hero: a field of arc-fragment crystals rises from the floor under one headline and two actions; a small panel shows
  the latest real settlement or says it is unavailable.
- Features: the field bursts to the edges, leaving the centre for two statements, one left and one right.
- Steps: the shards form a ring and a pinned horizontal track walks through Sign, Register, Approve, Offer, Pay early
  while the Arc mark rises in the centre.
- Agents: two 3D agents on pads joined by an arc channel; buttons act out offer, reject and accept.
- Why now: two sourced numbers in Sail.
- Final: a larger ring and mark behind the closing statement; below, a proof row of real or unavailable facts.

```
Hero                         Steps (pinned)                Agents
┌──────────────────────┐     ┌──────────────────────┐      ┌───────────────┬────────────┐
│ nav                  │     │   ╭─── ring ───╮     │      │ headline      │ ╭ stage ──╮│
│   HEADLINE (2 lines) │     │   │  1 / 5     │     │      │ copy          │ │ S ⌒⌒ B  ││
│   sub · [Open] [Proof]│     │   │ //01 SIGN  │ REG │      │ [Supplier][Buyer]│ ╰─────────╯│
│ ▲▲▲▲ crystal field ▲▲ │     │   ╰────────────╯     │      │ bullets       │ [Offer][Reject][Accept]
└──────────────────────┘     └──────────────────────┘      └───────────────┴────────────┘
```

## Principles
1. Boldness lives in the 3D scene; the type and the controls stay disciplined.
2. Colour carries meaning (above). No decorative colour on text or controls.
3. Structure is information: `//01` appears only on a true sequence, brace tags only on facts with a source.
4. Honest states: unavailable values say so; the illustration says it is an illustration.
5. The page works without WebGL, with reduced motion, and on a phone.

## Review against the spec
Differences from the spec's quiet principles are deliberate and recorded in `DECISIONS.md`: uppercase display
headings and a full-screen scene on the landing page only.

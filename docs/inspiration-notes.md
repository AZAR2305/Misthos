# Inspiration notes

Source: `docs/reference/Screen Recording 2026-10-05 193420.mp4` (24 s, 1920x1080), a Dribbble shot, "Web3 Landing Page Design" by
Extej UI UX Design Agency (dribbble.com/shots/26109429). The product shown is "REWARDER", a dark green Web3 staking
page. Used for structure, layout and interaction only (spec 10.9). Nothing from it is copied: not the name, copy,
colours, the Ethereum diamond, or the shard model.

## Section inventory (in scroll order)
1. Hero: huge uppercase two-line headline, one-line sub, a field of tall faceted crystals rising from the bottom
   edge. Nav: wordmark left, two-line hamburger, muted block button "JOIN WAITLIST" (wide letter-spacing).
2. Burst: on first scroll the crystals fly outward and tumble to the screen edges, centre clear. Feature blocks
   alternate left and right ("VARIABLE REVENUE", "FIXED REVENUE"): large uppercase heading, short paragraph.
3. Ring: the shards condense into a ring facing the camera, cropped by the viewport.
4. Carousel: scroll-pinned horizontal track of single words ("COMPARE", "DEPOSIT", "GAIN"), each with a
   two-line caption, a `1 / 3` counter and a short progress dash above. Neighbouring slides peek in from the edges.
5. Centre object: a large dark faceted Ethereum diamond appears inside the ring from slide 2.
6. Closing: "PERSONALIZE YOUR OWN FINANCIAL CONTRACTS" over the giant diamond with a button.

## Component inventory
Nav (brand, burger, block CTA), display heading, sub copy, instanced 3D shard field with scroll-driven formations,
scroll-pinned horizontal carousel with counter, central 3D object, CTA.

## Grid and spacing
Single centred column for the hero; feature blocks hug the left or right third. Generous vertical rhythm: each
beat is about one viewport tall. Heading about 70-90 px uppercase, caption about 13 px bold.

## Interaction patterns
Scroll drives everything (camera and formation morphs). Shards drift with a slow orbit. Specular glints move as the
camera moves. No hover states are visible in the recording.

## Assets and licence notes
Fonts and 3D assets are not available from a screen recording and were not reconstructed. The Dribbble shot is
the designer's work; we recreated the pattern with our own geometry and the Arc palette.

## Mapping to Misthos (spec 10.9 table)
| Misthos page | Reference section | Notes |
|---|---|---|
| P1 Landing | all of it | Hero crystals become arc fragments; carousel carries the spec's 5-step Stepper (Sign, Register, Approve, Offer, Pay early) |
| P3, P5, P8, P10 | none | The reference has no app screens. Build them from spec 10 and 11 |
| P8 curve panel | none | Custom, do not force-fit |

## What we added beyond the reference
- Arc palette and an original arch mark with a discount-curve inside it (the brand motif and the content are the same object, spec 10.6).
- An agents section with two 3D agents (supplier and buyer), interactive and clearly labelled as an illustration.
- A "why now" evidence section with sources, and a proof row that says "Unavailable" until the real values exist.

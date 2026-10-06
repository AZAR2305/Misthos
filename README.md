# Misthos Kit

An open agent kit for business payment timing, settled on Arc. Two businesses' agents agree the price of waiting on
an approved invoice, often 0%; a contract on Arc enforces the signed terms and settles in under a second.

Status: early. Built so far: the landing page with a 3D scene and two 3D agents (`frontend`). Everything else in
`docs/spec/CLAUDE-full.txt` is still to build. Testnet only, unaudited. MIT.

## Run the landing page
```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm shots          # screenshots at 375 / 768 / 1280 into frontend/shots (needs the dev server and Edge)
```
If `pnpm install` times out on a machine whose Node resolves only IPv6, see the "Machine quirk" note in
`docs/DECISIONS.md`.

## Where things are
- `frontend/design/tokens.css`: Arc theme tokens.
- `frontend/src/components/landing`: the scroll-driven 3D scene (`ShardScene`, `shards`, `scene-store`), the sections,
  and the agent stage (`AgentStage`, `Agents`).
- `frontend/public/models/RobotExpressive.glb`: CC0 agent model (Tomás Laulhé / Quaternius; morphs by Don McCurdy).
- `docs/`: decisions, design plan, inspiration notes, and the full build spec.

# backend

Postgres schema (CLAUDE.md section 6) and, later, the API route handlers, the chain indexer and the durable job outbox
(spec 5.3 and 9.2). Only the schema exists so far.

```bash
pnpm --filter @misthos/backend test   # applies db/schema.sql to PGlite and checks the constraints
```

`db/schema.sql` has no seed rows: the live app is empty until real activity exists (spec 0.5). Money columns are
`numeric(20,6)`; convert to bigint minor units at the edge. Chain writes go through `jobs` with a deterministic
idempotency key; chain events dedupe on `(tx_hash, log_index)`; claim tokens are stored only as a hash.

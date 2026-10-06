-- Migration 004: the signed decision log. Each agent writes its own hash chain and signs every entry with its wallet;
-- the API stores an entry only after it re-checks the hash, the signature and the place in that agent's chain.

alter table decisions add column signer text check (signer = lower(signer));
alter table decisions add column seq bigint;
alter table decisions add column invoice_ref text;   -- the chain invoice id the decision is about, or 'plan'
alter table decisions add column agent_at bigint;    -- unix seconds the agent decided

create unique index decisions_signer_seq on decisions (signer, seq) where signer is not null;
create index decisions_invoice_ref on decisions (invoice_ref);

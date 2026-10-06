-- Migration 003: single-use nonces for Google sign-in (stops a stolen ID token being replayed), and what claim links need
-- on top of the standing_offers table from migration 001.

create table google_nonces (
  nonce text primary key,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Standing offers are about on-chain invoices, which have no row in `invoices`, so the chain id is the reference.
alter table standing_offers alter column invoice_id drop not null;
alter table standing_offers add column chain_invoice_id text check (chain_invoice_id ~ '^0x[0-9a-f]{64}$');
alter table standing_offers add column created_by uuid references accounts(id);
alter table standing_offers add column supplier_address text check (supplier_address = lower(supplier_address));
alter table standing_offers add column signed_offer jsonb;        -- the supplier's signed EarlyPayOffer once claimed
alter table standing_offers add column declined_at timestamptz;
alter table standing_offers add check (invoice_id is not null or chain_invoice_id is not null);
create index standing_offers_chain_idx on standing_offers (chain_invoice_id, status);

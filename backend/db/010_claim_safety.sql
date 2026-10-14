-- Migration 010: claim link safety.
-- expected_supplier: the address the buyer said they expect to pay when they made the link (it must equal the invoice's own supplier).
-- payout_new: true when this buyer had never settled an invoice with that address before. The signed offer is then held back from the buyer until
-- they confirm the address (payout_confirmed_at). The payout address itself can never change: it is the supplier on the invoice, fixed on chain.
alter table standing_offers add column expected_supplier text check (expected_supplier = lower(expected_supplier));
alter table standing_offers add column payout_new boolean not null default false;
alter table standing_offers add column payout_confirmed_at timestamptz;

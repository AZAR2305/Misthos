-- Migration 008: private values do not belong in the shared store.
-- A buyer's hurdle, liquidity floor, caps and payment calendar, and a supplier's cost of waiting, stay with the owning agent
-- (an encrypted local store). The routes that wrote these tables are gone; the tables are dropped. Nothing in production used them.
-- What stays server-side on purpose: the exposure (risk) limits in exposure_policies, because the invoice registration gate enforces them.
drop table if exists policies;
drop table if exists supplier_prefs;
drop table if exists obligations;

-- Unused tables that could hold an email or a private reserve, dropped so nothing can start writing them by accident.
-- users: an email column the wallet-only sign-in never uses. rounds and bids: rounds.reserve_bps was "private to the buyer agent" and the
-- early-pay auction is not built. cascade removes only the foreign-key constraints that pointed at them.
drop table if exists bids cascade;
drop table if exists rounds cascade;
drop table if exists users cascade;

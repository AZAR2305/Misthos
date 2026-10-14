-- Migration 007: accounts are created from a wallet signature. No Google identity, no email, no third party.
-- The wallet address is the identity; the one-time sign-in message is stored with no account (the account does not exist yet).

drop table if exists google_nonces;

alter table accounts drop column if exists google_sub;
alter table accounts drop column if exists email;
alter table accounts drop column if exists email_verified;

alter table auth_challenges alter column account_id drop not null;

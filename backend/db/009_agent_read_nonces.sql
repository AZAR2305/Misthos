-- Migration 009: single-use nonces for signed agent reads, so a captured request cannot be replayed inside its time window.
create table agent_read_nonces (
  wallet text not null check (wallet = lower(wallet)),
  nonce text not null,
  expires_at timestamptz not null,
  primary key (wallet, nonce)
);
create index agent_read_nonces_expiry on agent_read_nonces (expires_at);

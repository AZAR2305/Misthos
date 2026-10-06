-- Migration 002: accounts (Google identity bound to one wallet and one side), sessions, wallet-link challenges, indexer
-- cursor and block times, and the columns the job worker needs. No seed rows (spec 0.5).

-- One Google identity <-> one wallet address <-> one side. google_sub and address are each unique.
create table accounts (
  id uuid primary key default gen_random_uuid(),
  google_sub text not null unique,
  email text not null,
  email_verified boolean not null,
  display_name text,
  org_id uuid references organizations(id),
  side org_role,
  address text unique check (address is null or address = lower(address)),
  address_bound_at timestamptz,
  created_at timestamptz not null default now(),
  check ((side is null) = (org_id is null))
);

-- Opaque session tokens; only the SHA-256 of the token is stored.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  account_id uuid not null references accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_account_idx on sessions (account_id);

-- One-time messages a wallet signs to prove it controls an address.
create table auth_challenges (
  nonce text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  address text not null check (address = lower(address)),
  message text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexer progress and the timestamp of every block that holds an event.
create table indexer_state (
  key text primary key,
  block bigint not null,
  updated_at timestamptz not null default now()
);
create table chain_blocks (
  block bigint primary key,
  time_sec bigint not null
);

-- Job worker: retry timing, the result of a finished job, and who asked for it.
alter table jobs add column run_after timestamptz not null default now();
alter table jobs add column result_json jsonb;
alter table jobs add column account_id uuid references accounts(id);
create index jobs_pending_idx on jobs (status, run_after);

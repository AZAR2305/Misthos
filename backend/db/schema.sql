-- Misthos Postgres schema (CLAUDE.md section 6).
-- Money columns are numeric(20,6) holding USDC; the code converts to and from 6-decimal bigint minor units at the edge.
-- Timestamps are timestamptz. IDs are uuid unless noted. Every table has created_at.
-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.
-- No seed rows: the live app is empty until real activity exists (spec 0.5).


create type org_role as enum ('supplier', 'buyer');
create type wallet_purpose as enum ('treasury', 'signer', 'agent', 'relayer');
create type wallet_mode as enum ('agent', 'managed');
create type data_source as enum ('pilot', 'sandbox');
create type invoice_status as enum ('draft', 'registered', 'approved', 'settled_early', 'settled_due', 'disputed');
create type offer_status as enum ('posted', 'accepted', 'rejected', 'expired');
create type decision_actor as enum ('supplier_agent', 'buyer_agent');
create type decision_outcome as enum ('auto_apply', 'needs_approval', 'rejected');
create type obligation_kind as enum ('payroll', 'bill', 'other');
create type message_type as enum ('offer', 'accept', 'reject', 'withdraw');
create type screening_result as enum ('clear', 'flagged', 'unavailable');
create type round_rule as enum ('pay_as_bid', 'uniform');
create type round_status as enum ('open', 'clearing', 'cleared', 'cancelled');
create type standing_offer_status as enum ('open', 'claimed', 'expired', 'withdrawn');
create type settlement_mode as enum ('ladder', 'round', 'claim');
create type job_status as enum ('pending', 'running', 'done', 'failed');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role org_role not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  circle_wallet_id text,
  address text not null check (address = lower(address)),
  purpose wallet_purpose not null,
  mode wallet_mode not null,
  created_at timestamptz not null default now(),
  unique (address)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  chain_id_hex text unique check (chain_id_hex ~ '^0x[0-9a-f]{64}$'),   -- bytes32 invoiceId (EIP-712 digest)
  supplier_org uuid not null references organizations(id),
  buyer_org uuid not null references organizations(id),
  amount numeric(20,6) not null check (amount > 0),
  due_date timestamptz not null,
  ref_hash text not null,
  nonce numeric(78,0) not null,
  status invoice_status not null default 'draft',
  approved_at timestamptz,
  source data_source not null default 'pilot',
  description text,                      -- UNTRUSTED text. Never sent to a decision prompt; escape on render.
  reg_tx text,
  approve_tx text,
  settle_tx text,
  created_at timestamptz not null default now(),
  check (supplier_org <> buyer_org)
);
create index invoices_status_idx on invoices (status);
create index invoices_buyer_idx on invoices (buyer_org, status);

create table offers (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  rung int not null,
  rate_bps int not null check (rate_bps between 0 and 5000),
  expiry timestamptz not null,
  nonce numeric(78,0) not null,
  signature text not null,
  status offer_status not null default 'posted',
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (invoice_id, rung, nonce)
);

-- Append-only, hash-chained decision log (spec 8.4). hash = keccak256(canonicalJson({prev_hash, actor, snapshot, ...})).
create table decisions (
  id uuid primary key default gen_random_uuid(),
  actor decision_actor not null,
  invoice_id uuid references invoices(id),
  snapshot_json jsonb not null,
  proposal_json jsonb,
  outcome decision_outcome not null,
  reason_code text,                      -- for example MODEL_UNAVAILABLE, SESSION_EXPIRED
  reason text not null,
  evidence_refs text[] not null default '{}',
  prev_hash text not null,
  hash text not null unique,
  signature text,
  created_at timestamptz not null default now()
);

create table obligations (
  id uuid primary key default gen_random_uuid(),
  buyer_org uuid not null references organizations(id),
  label text not null,
  amount numeric(20,6) not null check (amount > 0),
  due_date timestamptz not null,
  kind obligation_kind not null default 'other',
  created_at timestamptz not null default now()
);

-- Private to the buyer. hurdle_apr_bps never leaves the buyer agent (spec 3.3).
create table policies (
  buyer_org uuid primary key references organizations(id),
  hurdle_apr_bps int not null default 0 check (hurdle_apr_bps between 0 and 5000),
  liquidity_floor numeric(20,6) not null default 0 check (liquidity_floor >= 0),
  per_invoice_cap numeric(20,6) not null default 0,
  daily_cap numeric(20,6) not null default 0,
  human_above numeric(20,6) not null default 0,
  updated_tx text,
  created_at timestamptz not null default now()
);

create table supplier_prefs (
  supplier_org uuid primary key references organizations(id),
  cost_of_waiting_apr_bps int not null default 2200,
  max_rate_bps int not null default 5000,
  start_rate_bps int not null default 0,     -- adaptive after three past deals with a buyer (spec 8.2)
  step_bps int not null default 200,
  created_at timestamptz not null default now()
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  role org_role not null,
  wallet_address text not null check (wallet_address = lower(wallet_address)),
  wallet_mode wallet_mode not null,
  erc8004_agent_id text,
  a2a_card_url text,
  endpoint_url text,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  from_agent uuid not null references agents(id),
  to_agent uuid not null references agents(id),
  type message_type not null,
  rung int,
  rate_bps int,
  reason_code text,                      -- a reject carries a reason code, never the hurdle value
  payload_json jsonb not null,
  signature text not null,
  created_at timestamptz not null default now(),
  unique (invoice_id, rung, type, from_agent)    -- idempotent by (invoiceId, rung, type) (spec 8.6)
);

create table reputation_events (
  id uuid primary key default gen_random_uuid(),
  subject_agent uuid not null references agents(id),
  author_wallet text not null,
  invoice_id uuid references invoices(id),
  tag text not null check (tag in ('paid_early', 'approved_fast', 'invoice_accurate', 'slow_accept', 'disputed')),
  value int not null,
  evidence_hash text,
  tx_hash text,
  source data_source not null,
  created_at timestamptz not null default now()
);

create table screenings (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  provider text not null,
  result screening_result not null,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Tier 3 (only for real rounds or the disclosed showcase, spec 3.14)
create table rounds (
  id uuid primary key default gen_random_uuid(),
  buyer_org uuid not null references organizations(id),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  budget numeric(20,6) not null,
  reserve_bps int not null,              -- private to the buyer agent
  share_cap_bps int not null,
  rule round_rule not null default 'uniform',
  status round_status not null default 'open',
  clearing_rate_bps int,
  batch_tx text,
  created_at timestamptz not null default now()
);

create table bids (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id),
  invoice_id uuid not null references invoices(id),
  supplier_agent uuid not null references agents(id),
  max_rate_bps int not null,
  offer_sig text not null,
  expiry timestamptz not null,
  outcome text check (outcome in ('won', 'lost')),
  reason_code text,
  rate_paid_bps int,
  created_at timestamptz not null default now()
);

create table standing_offers (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  rate_bps int not null,
  expiry timestamptz not null,
  claim_token_hash text not null unique,  -- never store the token itself
  status standing_offer_status not null default 'open',
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  round_id uuid references rounds(id),
  mode settlement_mode not null,
  rate_bps int not null,
  net numeric(20,6) not null,
  discount numeric(20,6) not null,
  fee numeric(20,6) not null default 0,
  tx_hash text not null,
  source data_source not null,
  created_at timestamptz not null default now()
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  invoice_id uuid not null references invoices(id),
  account text not null,
  debit numeric(20,6) not null default 0,
  credit numeric(20,6) not null default 0,
  memo text,
  tx_hash text,
  created_at timestamptz not null default now()
);

-- Indexer output. log_index is never null so UNIQUE(tx_hash, log_index) really dedupes (spec 6).
create table chain_events (
  tx_hash text not null,
  log_index int not null,
  block bigint not null,
  name text not null,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (tx_hash, log_index)
);

-- Durable outbox for chain writes. The idempotency key is deterministic, so a restart never double-sends.
create table jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  kind text not null,
  payload_json jsonb not null,
  status job_status not null default 'pending',
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

-- Migration 005: the credit and exposure policy each business sets for the counterparties it deals with (SRS FR-05).
-- One current row per organisation, and every version ever saved, so a decision made under an old version can still be explained.
-- Limits are private to the business. Unknown counterparties get new_counterparty_limit, which starts at 0 (never positive by default).

create table exposure_policies (
  org_id uuid primary key references organizations(id),
  version int not null default 1 check (version >= 1),
  new_counterparty_limit numeric(20,6) not null default 0 check (new_counterparty_limit >= 0),
  max_limit numeric(20,6) not null default 0 check (max_limit >= 0),
  growth_bps int not null default 2000 check (growth_bps between 0 and 10000),
  lookback_days int not null default 180 check (lookback_days between 1 and 730),
  grace_seconds int not null default 86400 check (grace_seconds between 0 and 2592000),
  updated_at timestamptz not null default now(),
  check (max_limit >= new_counterparty_limit)
);

create table exposure_policy_versions (
  org_id uuid not null references organizations(id),
  version int not null,
  new_counterparty_limit numeric(20,6) not null,
  max_limit numeric(20,6) not null,
  growth_bps int not null,
  lookback_days int not null,
  grace_seconds int not null,
  saved_at timestamptz not null default now(),
  primary key (org_id, version)
);

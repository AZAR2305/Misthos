-- Migration 006: linking an agent wallet to a business.
-- The signed-in owner makes a one-time code on the website; their agent redeems it with a request signed by its own wallet.
-- Both halves are needed, so nobody can attach an agent they do not control to their business, or someone else's agent to theirs.
-- Only the SHA-256 of a code is stored, and a code works once, within minutes.

create table agent_link_codes (
  code_hash text primary key,
  org_id uuid not null references organizations(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

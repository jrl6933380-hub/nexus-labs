-- ============================================================
-- FORGE CALLER PROGRAM SCHEMA
-- Scales from 1 caller (James) to many, keeps commission,
-- ownership, and lifecycle history fully auditable.
-- ============================================================

-- ---------- CALLERS ----------
-- Every person making calls, including future hires.
create table callers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  phone text,
  status text not null default 'active' check (status in ('active','paused','removed')),
  signup_bonus_basic numeric(10,2) not null default 10.00,
  signup_bonus_standard numeric(10,2) not null default 20.00,
  signup_bonus_plus numeric(10,2) not null default 35.00,
  recurring_commission_pct numeric(5,4) not null default 0.15,
  upgrade_bonus_flat numeric(10,2) not null default 10.00,
  stripe_connect_account_id text,
  created_at timestamptz not null default now()
);

-- ---------- LEADS ----------
create table leads (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid references callers(id),
  business_name text not null,
  phone text,
  address text,
  category text,
  has_website boolean not null default false,
  review_count int,
  review_rating numeric(2,1),
  competitor_data jsonb,
  pitch_angles jsonb,
  status text not null default 'scraped'
    check (status in ('scraped','draft_generated','contacted','converted','dead')),
  scraped_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_leads_caller_status on leads(caller_id, status);

-- ---------- DRAFTS ----------
create table drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  batch_id uuid,
  status text not null default 'generating'
    check (status in ('generating','ready','failed','promoted')),
  site_content jsonb,
  preview_url text,
  generated_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_drafts_lead on drafts(lead_id);
create index idx_drafts_batch on drafts(batch_id);

-- ---------- CLIENTS ----------
create table clients (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  draft_id uuid references drafts(id),
  business_name text not null,
  tier text not null check (tier in ('basic','standard','plus')),
  status text not null default 'active'
    check (status in ('active','canceling','placeholder','churned')),
  landed_by uuid not null references callers(id),
  assigned_to uuid references callers(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  signed_up_at timestamptz not null default now(),
  cancel_requested_at timestamptz,
  placeholder_started_at timestamptz,
  churned_at timestamptz,
  updated_at timestamptz not null default now()
);
create index idx_clients_landed_by on clients(landed_by);
create index idx_clients_assigned_to on clients(assigned_to);
create index idx_clients_status on clients(status);

-- ---------- OWNERSHIP TRANSFERS ----------
create table ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  from_caller_id uuid references callers(id),
  to_caller_id uuid not null references callers(id),
  reason text,
  transferred_at timestamptz not null default now(),
  transferred_by text
);

-- ---------- COMMISSION EVENTS ----------
create table commission_events (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references callers(id),
  client_id uuid not null references clients(id),
  event_type text not null
    check (event_type in ('signup_bonus','upgrade_bonus','recurring','manual_adjustment')),
  amount numeric(10,2) not null,
  tier_at_event text,
  stripe_transfer_id text,
  status text not null default 'pending'
    check (status in ('pending','paid','failed')),
  occurred_at timestamptz not null default now()
);
create index idx_commission_caller on commission_events(caller_id);
create index idx_commission_client on commission_events(client_id);

-- ---------- MAINTENANCE EDITS ----------
create table maintenance_edits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  description text,
  source text not null default 'allotment' check (source in ('allotment','topup')),
  topup_payment_id text,
  performed_at timestamptz not null default now()
);
create index idx_maintenance_client on maintenance_edits(client_id);

-- ---------- CLIENT STATUS LOG ----------
create table client_status_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  from_status text,
  to_status text not null,
  new_tier text,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index idx_status_log_client on client_status_log(client_id);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  backdrop_url text,
  view_config jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists pinned_visuals (
  room_id text primary key check (room_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  widget_code text not null default '',
  source text not null default 'nex',
  locked boolean not null default false,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists forge_callers (
  id uuid primary key default gen_random_uuid(),
  forge_username text not null unique,
  display_name text not null,
  status text not null default 'active' check (status in ('active','paused','removed')),
  signup_bonus_basic numeric(10,2) not null default 10.00,
  signup_bonus_standard numeric(10,2) not null default 20.00,
  signup_bonus_plus numeric(10,2) not null default 35.00,
  recurring_pct numeric(5,4) not null default 0.15,
  upgrade_bonus numeric(10,2) not null default 10.00,
  stripe_connect_account_id text,
  created_at timestamptz not null default now()
);
create table if not exists forge_state_clearances (
  state_code char(2) primary key,
  cleared_at timestamptz not null default now(),
  cleared_by text,
  notes text
);
create table if not exists forge_leads (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid references forge_callers(id),
  business_name text not null,
  phone text not null,
  address text,
  city text,
  state_code char(2),
  category text,
  has_website boolean not null default false,
  website_url text,
  review_count integer,
  review_rating numeric(2,1),
  competitor_data jsonb not null default '[]'::jsonb,
  pitch_angles jsonb not null default '[]'::jsonb,
  source jsonb not null default '{}'::jsonb,
  status text not null default 'scraped' check (status in ('scraped','draft_generated','contacted','converted','dead')),
  disposition text,
  suppressed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone, business_name)
);
create index if not exists forge_leads_queue on forge_leads (caller_id, status) where (not suppressed);
create index if not exists forge_leads_state on forge_leads (state_code);
create table if not exists forge_drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references forge_leads(id) on delete cascade,
  batch_id uuid,
  status text not null default 'generating' check (status in ('generating','ready','failed','promoted')),
  site_content jsonb,
  preview_url text,
  error text,
  generated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists forge_drafts_batch on forge_drafts (batch_id);
create index if not exists forge_drafts_lead on forge_drafts (lead_id);
create table if not exists forge_clients (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references forge_leads(id),
  draft_id uuid references forge_drafts(id),
  business_name text not null,
  phone text,
  tier text not null check (tier in ('basic','standard','plus')),
  ai_assistant_addon boolean not null default false,
  status text not null default 'pending_payment' check (status in ('pending_payment','active','canceling','placeholder','churned')),
  landed_by uuid not null references forge_callers(id),
  commission_owner uuid not null references forge_callers(id),
  assigned_to uuid references forge_callers(id),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  signed_up_at timestamptz not null default now(),
  cancel_requested_at timestamptz,
  placeholder_started_at timestamptz,
  followup_due_at timestamptz,
  churned_at timestamptz,
  updated_at timestamptz not null default now(),
  checkout_url text,
  paid_at timestamptz
);
create index if not exists forge_clients_assigned on forge_clients (assigned_to);
create index if not exists forge_clients_followup on forge_clients (followup_due_at) where (status = 'placeholder');
create unique index if not exists forge_clients_one_per_lead on forge_clients (lead_id) where (lead_id is not null);
create index if not exists forge_clients_owner on forge_clients (commission_owner);
create index if not exists forge_clients_status on forge_clients (status);
create table if not exists forge_client_status_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references forge_clients(id),
  from_status text,
  to_status text not null,
  tier text,
  changed_by text not null,
  changed_at timestamptz not null default now()
);
create index if not exists forge_status_log_client on forge_client_status_log (client_id);
create table if not exists forge_commission_events (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references forge_callers(id),
  client_id uuid not null references forge_clients(id),
  event_type text not null check (event_type in ('signup_bonus','upgrade_bonus','recurring','manual_adjustment')),
  amount numeric(10,2) not null,
  tier_at_event text,
  source_ref text not null,
  stripe_transfer_id text,
  status text not null default 'pending' check (status in ('pending','paid','failed','void')),
  occurred_at timestamptz not null default now(),
  unique (event_type, source_ref)
);
create index if not exists forge_commission_caller on forge_commission_events (caller_id, status);
create table if not exists forge_maintenance_edits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references forge_clients(id),
  description text,
  source text not null default 'allotment' check (source in ('allotment','topup')),
  topup_payment_ref text,
  performed_at timestamptz not null default now()
);
create index if not exists forge_maintenance_client_month on forge_maintenance_edits (client_id, performed_at);
create table if not exists forge_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references forge_clients(id),
  from_caller_id uuid references forge_callers(id),
  to_caller_id uuid not null references forge_callers(id),
  reason text,
  transferred_by text not null,
  transferred_at timestamptz not null default now()
);
create table if not exists forge_topup_credits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references forge_clients(id),
  edits_granted integer not null default 3,
  payment_ref text not null unique,
  purchased_at timestamptz not null default now()
);

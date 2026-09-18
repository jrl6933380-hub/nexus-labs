create table if not exists public.pinned_visuals (
  room_id text primary key check (room_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  widget_code text not null default '',
  source text not null default 'nex',
  locked boolean not null default false,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.pinned_visuals enable row level security;
revoke all on table public.pinned_visuals from anon, authenticated;

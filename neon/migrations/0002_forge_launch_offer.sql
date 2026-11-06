-- Forge introductory price: NEW subscriptions only. Preserve existing Basic/Standard/Plus customers.
-- Must be applied to Neon BEFORE deploying the launch caller UI.
begin;
alter table forge_clients drop constraint if exists forge_clients_tier_check;
alter table forge_clients add constraint forge_clients_tier_check
  check (tier in ('launch','basic','standard','plus'));
-- No signup commission was specified for the new offer. Default 0; editable by operator later.
alter table forge_callers add column if not exists signup_bonus_launch numeric(10,2) not null default 0.00;
commit;

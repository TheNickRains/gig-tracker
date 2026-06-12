-- Migration 017: push notifications + recurring weekly blocks + live calendar.
-- Run in the Supabase SQL editor.

-- Web-push subscriptions (one row per browser/device).
create table if not exists push_subscriptions (
  artist_id  uuid not null references artists(id) on delete cascade,
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy push_own on push_subscriptions for all to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());

-- Worker-only secrets (VAPID keypair lives here; NO client policies on purpose —
-- only the service role can read/write).
create table if not exists app_secrets (
  id    text primary key,
  value jsonb not null
);
alter table app_secrets enable row level security;

-- Recurring weekly blocks ("every Sunday is blocked").
create table if not exists availability_rules (
  artist_id uuid not null references artists(id) on delete cascade,
  dow       smallint not null check (dow between 0 and 6), -- 0 = Sunday
  status    text not null default 'busy' check (status in ('busy')),
  primary key (artist_id, dow)
);
alter table availability_rules enable row level security;
create policy avail_rules_own on availability_rules for all to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());

-- Calendar updates stream to the open app (worker busy-imports appear live).
alter publication supabase_realtime add table availability;

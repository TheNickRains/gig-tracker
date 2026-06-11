-- Migration 003: per-artist Google connection (Gmail + Calendar).
-- Stores the OAuth refresh token the backend worker uses to call Google APIs.
-- Run in the Supabase SQL editor.

create table if not exists google_connections (
  artist_id     uuid primary key references artists(id) on delete cascade,
  refresh_token text not null,
  scope         text,
  updated_at    timestamptz default now()
);

alter table google_connections enable row level security;

-- An artist may write (connect/refresh) ONLY their own row. There is deliberately
-- NO select policy — the client can never read a refresh token back. The worker
-- reads tokens with the service_role key, which bypasses RLS.
create policy gc_insert_own on google_connections for insert to authenticated
  with check (artist_id = auth.uid());
create policy gc_update_own on google_connections for update to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());

-- Client-readable flag so the UI can show "Connected" without exposing the token.
alter table artists add column if not exists gmail_connected boolean default false;
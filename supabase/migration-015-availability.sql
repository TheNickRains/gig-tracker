-- Migration 015 (Slice D start): in-app calendar availability.
-- One row per artist per day; absence = no preference set.
-- Run in the Supabase SQL editor.
create table if not exists availability (
  artist_id uuid not null references artists(id) on delete cascade,
  day       date not null,
  status    text not null check (status in ('available','busy')),
  primary key (artist_id, day)
);
alter table availability enable row level security;
create policy avail_own on availability for all to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());

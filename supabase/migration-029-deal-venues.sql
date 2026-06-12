-- Migration 029: rooms in play — one opportunity can span several of a
-- booker's rooms until one wins (the deal keeps ONE primary venue).
-- Run in the Supabase SQL editor.
create table if not exists deal_venues (
  entry_id uuid not null references pipeline_entries(id) on delete cascade,
  venue_id uuid not null references venues(id) on delete cascade,
  primary key (entry_id, venue_id)
);
alter table deal_venues enable row level security;
create policy dv_own on deal_venues for all to authenticated
  using (exists (select 1 from pipeline_entries pe where pe.id = entry_id and pe.artist_id = auth.uid()))
  with check (exists (select 1 from pipeline_entries pe where pe.id = entry_id and pe.artist_id = auth.uid()));

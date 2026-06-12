-- Migration 020 (Slice E begins): the Collective.
-- Run in the Supabase SQL editor.

-- Home market (Settings) — feeds Discover defaults + AI context.
alter table artists add column if not exists home_market text;

-- Who added a venue (powers "new from the collective" dots + the feed).
alter table venues add column if not exists created_by uuid references artists(id);
alter table venues alter column created_by set default auth.uid();

-- Venue comments: the collective's shared ground truth on every room.
-- author_name denormalized at post time (artists rows are RLS-private).
create table if not exists venue_comments (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id) on delete cascade,
  artist_id   uuid not null references artists(id) on delete cascade,
  author_name text not null default '',
  body        text not null,
  created_at  timestamptz not null default now()
);
alter table venue_comments enable row level security;
create policy vc_read   on venue_comments for select to authenticated using (true);
create policy vc_insert on venue_comments for insert to authenticated with check (artist_id = auth.uid());
create policy vc_delete on venue_comments for delete to authenticated using (artist_id = auth.uid());

alter publication supabase_realtime add table venue_comments;

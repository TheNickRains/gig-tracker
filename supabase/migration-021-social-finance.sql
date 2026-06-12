-- Migration 021 (Slice E wrap): comment social layer, venue provenance,
-- gig wins wall, gig financials.
-- Run in the Supabase SQL editor.

-- Threaded comments + author avatars (denormalized — artists rows are private).
alter table venue_comments add column if not exists parent_id uuid references venue_comments(id) on delete cascade;
alter table venue_comments add column if not exists author_avatar text;

-- Reactions: one per artist per comment, up or down.
create table if not exists venue_comment_reactions (
  comment_id uuid not null references venue_comments(id) on delete cascade,
  artist_id  uuid not null references artists(id) on delete cascade,
  kind       text not null check (kind in ('up','down')),
  primary key (comment_id, artist_id)
);
alter table venue_comment_reactions enable row level security;
create policy vcr_read  on venue_comment_reactions for select to authenticated using (true);
create policy vcr_write on venue_comment_reactions for all to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());

-- Who put the venue in (shown on the venue detail + feed).
alter table venues add column if not exists created_by_name text;

-- The wins wall: who has booked/played this room (pipelines are private, so
-- the win itself is shared deliberately when a deal hits booked/played).
create table if not exists venue_wins (
  venue_id    uuid not null references venues(id) on delete cascade,
  artist_id   uuid not null references artists(id) on delete cascade,
  author_name text not null default '',
  avatar_url  text,
  status      text not null default 'booked' check (status in ('booked','played')),
  created_at  timestamptz not null default now(),
  primary key (venue_id, artist_id)
);
alter table venue_wins enable row level security;
create policy vw_read  on venue_wins for select to authenticated using (true);
create policy vw_write on venue_wins for all to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());

-- Gig financials (tracking foundations for the tour planner).
alter table pipeline_entries add column if not exists gig_pay text;
alter table pipeline_entries add column if not exists gig_costs text;

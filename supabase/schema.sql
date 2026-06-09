-- Gig Collective — Supabase schema
-- Mirrors the prototype data model in gig-collective.html.
-- Three layers: venue (institution, permanent) -> contact (semi-permanent) -> pipeline entry (one artist's pursuit).
-- Run this in the Supabase SQL editor on a fresh project.

-- ── Extensions ──────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── Artists (the roster; one row per app user, keyed to auth) ──
create table if not exists artists (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  genre         text,
  oneliner      text,
  phone         text,
  website       text,
  epk           text,
  spotify       text,
  draw_claim    text,
  typical_crowd text,
  set_formats   text,
  notable       text,
  home_market   text,
  markets       text[] default '{}',
  created_at    timestamptz default now()
);

-- ── Venues (institutions — shared collective layer) ──
create table if not exists venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  state       text,
  ticket_type text check (ticket_type in ('soft','hard')),
  venue_type  text,
  pay_range   text,
  clientele   text,
  notes       text,
  created_by  uuid references artists(id) on delete set null,
  created_at  timestamptz default now()
);

-- ── Contacts (the human; child of venue; multiple allowed) ──
create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references venues(id) on delete cascade,
  name         text,
  title        text,
  email        text,
  phone        text,
  verified_by  uuid references artists(id) on delete set null,
  verified_at  timestamptz,
  created_at   timestamptz default now()
);
create index if not exists contacts_email_idx on contacts (lower(email));

-- ── Pipeline entries (one artist pursuing one venue — private) ──
create table if not exists pipeline_entries (
  id              uuid primary key default gen_random_uuid(),
  artist_id       uuid not null references artists(id) on delete cascade,
  venue_id        uuid not null references venues(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  status          text not null default 'outreach'
                    check (status in ('outreach','waiting','followup','won','dead')),
  followup_date   date,
  last_activity_at timestamptz default now(),
  created_at      timestamptz default now(),
  unique (artist_id, venue_id)
);

-- ── Activities (timestamped log; manual notes + email-sync events) ──
create table if not exists activities (
  id                uuid primary key default gen_random_uuid(),
  pipeline_entry_id uuid not null references pipeline_entries(id) on delete cascade,
  kind              text not null default 'note'
                      check (kind in ('note','email_in','email_out','call','status_change','system')),
  body              text,
  source            text not null default 'manual' check (source in ('manual','email_sync')),
  email_message_id  text,            -- Gmail message id, for de-duping the inbox watcher
  created_at        timestamptz default now()
);
-- Prevent the email watcher from logging the same message twice.
create unique index if not exists activities_email_msg_uidx
  on activities (email_message_id) where email_message_id is not null;

-- ── Auto-create an artist row on signup ──
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.artists (id, email, display_name)
  values (new.id, new.email, split_part(new.email,'@',1))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Row Level Security ──
-- Principle (from handoff.md): individual pipelines are private input;
-- venue/contact intelligence is the shared collective output.
alter table artists          enable row level security;
alter table venues           enable row level security;
alter table contacts         enable row level security;
alter table pipeline_entries enable row level security;
alter table activities       enable row level security;

-- Artists: everyone in the collective can see the roster; you edit only yourself.
create policy artists_select_all on artists for select to authenticated using (true);
create policy artists_update_own on artists for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy artists_insert_own on artists for insert to authenticated
  with check (id = auth.uid());

-- Venues & contacts: shared. Any member can read, add, and refine.
create policy venues_select_all on venues for select to authenticated using (true);
create policy venues_write_all  on venues for all    to authenticated using (true) with check (true);
create policy contacts_select_all on contacts for select to authenticated using (true);
create policy contacts_write_all  on contacts for all    to authenticated using (true) with check (true);

-- Pipeline entries: strictly private to the owning artist.
create policy pipeline_own on pipeline_entries for all to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());

-- Activities: visible/editable only via the owner's pipeline entry.
create policy activities_own on activities for all to authenticated
  using (exists (
    select 1 from pipeline_entries p
    where p.id = activities.pipeline_entry_id and p.artist_id = auth.uid()
  ))
  with check (exists (
    select 1 from pipeline_entries p
    where p.id = activities.pipeline_entry_id and p.artist_id = auth.uid()
  ));

-- NOTE: the inbox watcher (Apps Script, slice 2) writes with the service_role
-- key, which bypasses RLS — so it can append email activities and advance
-- statuses on the artist's behalf without any client-side credential exposure.

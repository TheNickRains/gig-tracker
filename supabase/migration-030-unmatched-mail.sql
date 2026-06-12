-- Migration 030: unrecognized inbox mail — triage on the war room.
-- The worker parks inbound that matches no known contact here; "Add to deal"
-- ingests it AND creates the person (so future mail auto-matches); Dismiss hides.
-- Run in the Supabase SQL editor.
create table if not exists unmatched_mail (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references artists(id) on delete cascade,
  gmail_id    text not null unique,
  thread_id   text,
  from_email  text,
  from_name   text,
  subject     text,
  body        text,
  status      text not null default 'new' check (status in ('new','linked','dismissed')),
  created_at  timestamptz not null default now()
);
alter table unmatched_mail enable row level security;
create policy um_own on unmatched_mail for all to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());
alter publication supabase_realtime add table unmatched_mail;

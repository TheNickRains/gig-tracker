-- Migration 026: THE PROMOTION — contacts become first-class PEOPLE.
-- People span rooms (talent buyers); venue_people links them to rooms with a
-- role; deals point at the person. Existing contacts are deduped by email into
-- people (same email = same human), links and deals are backfilled.
-- Run in the Supabase SQL editor.

create table if not exists people (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  title      text,           -- default role ("Talent buyer")
  org        text,           -- "ATG Entertainment"
  email      text,
  phone      text,
  linkedin   text,
  instagram  text,
  created_by uuid references artists(id),
  created_at timestamptz not null default now()
);
create unique index if not exists people_email_uidx on people (lower(email)) where email is not null and email <> '';

alter table people enable row level security;
create policy people_read  on people for select to authenticated using (true);
create policy people_write on people for all to authenticated using (true) with check (true);

create table if not exists venue_people (
  venue_id   uuid not null references venues(id) on delete cascade,
  person_id  uuid not null references people(id) on delete cascade,
  role       text,           -- role AT THIS ROOM (optional override)
  created_at timestamptz not null default now(),
  primary key (venue_id, person_id)
);
alter table venue_people enable row level security;
create policy vp_read  on venue_people for select to authenticated using (true);
create policy vp_write on venue_people for all to authenticated using (true) with check (true);

alter table pipeline_entries add column if not exists person_id uuid references people(id);

-- ── Backfill ──
-- One person per distinct email (no-email contacts each become their own person).
insert into people (id, name, title, email, phone, linkedin, instagram)
select distinct on (coalesce(nullif(lower(email), ''), id::text))
  id, name, title, nullif(email, ''), phone, linkedin, instagram
from contacts
order by coalesce(nullif(lower(email), ''), id::text), verified_at desc nulls last
on conflict do nothing;

-- Room links (a buyer at 3 rooms = one person, three links).
insert into venue_people (venue_id, person_id, role)
select c.venue_id, coalesce(p.id, c.id), c.title
from contacts c
left join people p on p.email is not null and c.email is not null and lower(p.email) = lower(c.email)
where c.venue_id is not null
on conflict (venue_id, person_id) do nothing;

-- Deals point at people.
update pipeline_entries e
set person_id = coalesce(p.id, c.id)
from contacts c
left join people p on p.email is not null and c.email is not null and lower(p.email) = lower(c.email)
where e.contact_id = c.id and e.person_id is null;

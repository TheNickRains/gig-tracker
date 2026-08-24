-- The +1: confirming a collective record while you're literally on the phone
-- with the venue. Freshness is the collective Rolodex's whole pitch.
alter table venues
  add column if not exists verify_count int not null default 0,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references artists(id);
alter table people
  add column if not exists verify_count int not null default 0,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references artists(id);

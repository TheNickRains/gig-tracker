-- Orgs become first-class: booking agencies, promoters, festival organizers,
-- management — buyers who book ACROSS rooms and were previously shoehorned in
-- as a 'Promoter / agency' venue type. Deals attach to a venue OR an org;
-- people can belong to an org.
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_type text,                 -- Booking agency · Promoter · Festival organizer · Management · Other
  city text, state text,
  website text, phone text,
  books text,                    -- what they mostly buy: 'soft' | 'hard' | 'both'
  notes text,
  created_by uuid references artists(id),
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table orgs enable row level security;
create policy orgs_select_all on orgs for select to authenticated using (true);
create policy orgs_write_all  on orgs for all    to authenticated using (true) with check (true);

alter table people add column if not exists org_id uuid references orgs(id);

alter table pipeline_entries add column if not exists org_id uuid references orgs(id);
alter table pipeline_entries alter column venue_id drop not null;
alter table pipeline_entries add constraint pe_counterparty
  check (venue_id is not null or org_id is not null);

-- Private Google sync cursor, durable wakeups, and one desired job per occurrence.
create table public.calendar_publish_state (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  calendar_id text not null,
  cursor text,
  channels jsonb not null default '[]',
  received bigint not null default 0,
  processed bigint not null default 0
);
create table public.calendar_publish_shows (
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_id text not null,
  series_id text,
  public_id uuid not null default gen_random_uuid() unique,
  revision uuid not null default gen_random_uuid(),
  listing jsonb,
  fingerprint text not null,
  operation text not null check (operation in ('upsert','remove','ignore')),
  status text not null check (status in ('preview','pending','working','published','removed','ignored','review')),
  issue text,
  bandsintown_id text,
  calendar_link text,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (artist_id, event_id)
);
alter table public.calendar_publish_state enable row level security;
alter table public.calendar_publish_shows enable row level security;
revoke all on public.calendar_publish_state from anon, authenticated;
revoke all on public.calendar_publish_shows from anon, authenticated;
grant select on public.calendar_publish_shows to authenticated;
create policy calendar_publish_owner on public.calendar_publish_shows for select to authenticated
  using ((select auth.uid()) = artist_id);
alter publication supabase_realtime add table public.calendar_publish_shows;

create function public.calendar_publish_receive(p_artist uuid)
returns void language sql set search_path = ''
as $$
  update public.calendar_publish_state set received = received + 1 where artist_id = p_artist;
$$;

create function public.calendar_publish_apply(
  p_artist uuid, p_cursor text, p_expected text, p_received bigint,
  p_rows jsonb, p_live boolean, p_pilot_event text
) returns integer language plpgsql set search_path = ''
as $$
declare affected integer;
begin
  update public.calendar_publish_state set cursor = p_cursor, processed = greatest(processed, p_received)
  where artist_id = p_artist and cursor is not distinct from p_expected;
  if not found then return -1; end if;

  insert into public.calendar_publish_shows as prior
    (artist_id, event_id, series_id, listing, fingerprint, operation, status, issue, calendar_link)
  select p_artist, x.event_id, x.series_id, x.listing, x.fingerprint, x.operation,
    case when x.issue is not null then 'review'
         when x.operation = 'ignore' then 'ignored'
         when p_live and (p_pilot_event is null or x.event_id = p_pilot_event) then 'pending' else 'preview' end,
    x.issue, x.calendar_link
  from jsonb_to_recordset(p_rows) as x(event_id text, series_id text, listing jsonb,
    fingerprint text, operation text, issue text, calendar_link text)
  on conflict (artist_id, event_id) do update set
    revision = gen_random_uuid(),
    series_id = coalesce(excluded.series_id, prior.series_id),
    listing = excluded.listing,
    fingerprint = excluded.fingerprint,
    operation = excluded.operation,
    status = case
      when excluded.operation = 'remove' and prior.bandsintown_id is null and prior.started_at is null then 'removed'
      else excluded.status end,
    issue = excluded.issue,
    calendar_link = coalesce(excluded.calendar_link, prior.calendar_link),
    started_at = case when prior.status in ('working', 'review') then prior.started_at else null end,
    updated_at = now()
  where prior.fingerprint <> excluded.fingerprint
    or (excluded.status = 'pending' and prior.status = 'preview');
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function public.calendar_publish_claim(p_artist uuid, p_pilot_event text)
returns setof public.calendar_publish_shows language plpgsql set search_path = ''
as $$
begin
  perform 1 from public.calendar_publish_state where artist_id = p_artist for update;
  update public.calendar_publish_shows set status = 'review',
    issue = 'The browser disconnected before verifying the result. Check Bandsintown before retrying.',
    updated_at = now()
  where artist_id = p_artist and status = 'working' and started_at < now() - interval '10 minutes';
  if exists (select 1 from public.calendar_publish_shows where artist_id = p_artist and status = 'working')
    then return; end if;
  return query update public.calendar_publish_shows as shows
    set status = 'working', started_at = now(), updated_at = now()
    where shows.artist_id = p_artist and shows.event_id = (
      select e.event_id from public.calendar_publish_shows e
      where e.artist_id = p_artist and e.status = 'pending'
        and (p_pilot_event is null or e.event_id = p_pilot_event)
      order by e.updated_at, e.event_id limit 1 for update skip locked
    ) returning shows.*;
end;
$$;

revoke execute on function public.calendar_publish_receive(uuid) from public, anon, authenticated;
revoke execute on function public.calendar_publish_apply(uuid,text,text,bigint,jsonb,boolean,text) from public, anon, authenticated;
revoke execute on function public.calendar_publish_claim(uuid,text) from public, anon, authenticated;
grant execute on function public.calendar_publish_receive(uuid) to service_role;
grant execute on function public.calendar_publish_apply(uuid,text,text,bigint,jsonb,boolean,text) to service_role;
grant execute on function public.calendar_publish_claim(uuid,text) to service_role;
grant all on public.calendar_publish_state, public.calendar_publish_shows to service_role;

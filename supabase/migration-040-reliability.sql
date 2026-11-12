-- Reliability audit fixes. Apply with the old worker stopped, then deploy the
-- matching worker/client. RPCs replace unrestricted browser queue mutations.
begin;

alter table scheduled_messages drop constraint if exists scheduled_messages_status_check;
alter table scheduled_messages add constraint scheduled_messages_status_check
  check (status in ('scheduled','ready','sending','uncertain','sent','canceled','failed'));
alter table scheduled_messages add column if not exists updated_at timestamptz not null default clock_timestamp();
alter table scheduled_messages add column if not exists attempt_started_at timestamptz;
alter table scheduled_messages add column if not exists gmail_message_id text;
alter table scheduled_messages add column if not exists rfc_message_id text;
alter table scheduled_messages add column if not exists sent_via text;
alter table scheduled_messages add column if not exists activity_recorded boolean not null default false;
alter table google_connections add column if not exists history_synced_at timestamptz;
alter table google_connections add column if not exists google_email text;

-- The old worker had no durable claims/receipts. Keep outstanding work for
-- review at cutover; do not replay potentially accepted legacy sends.
update scheduled_messages set status='ready',cancel_reason='Saved before the reliability update — review before sending'
  where status='scheduled';
update scheduled_messages set status='uncertain',cancel_reason='Earlier attempt has no delivery receipt. Verify Gmail Sent before retrying'
  where status='failed' and coalesce(cancel_reason,'') not ilike '%Gmail not connected%';

create or replace function store_google_token(p_refresh_token text,p_scope text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or nullif(trim(p_refresh_token),'') is null then raise exception 'A signed-in account and Google token are required'; end if;
  insert into google_connections(artist_id,refresh_token,scope,updated_at)
    values(auth.uid(),p_refresh_token,p_scope,now())
    on conflict(artist_id) do update set refresh_token=excluded.refresh_token,scope=excluded.scope,updated_at=now(),
      google_email=null,history_id=null,history_synced_at=null,watch_expiry=null;
  update artists set gmail_connected=true where id=auth.uid();
end $$;
revoke all on function store_google_token(text,text) from public;
grant execute on function store_google_token(text,text) to authenticated;

create or replace function message_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists message_updated_at on scheduled_messages;
create trigger message_updated_at before update on scheduled_messages for each row execute function message_updated_at();

create table if not exists message_drafts (
  pipeline_entry_id uuid primary key references pipeline_entries(id) on delete cascade,
  artist_id uuid not null references artists(id) on delete cascade,
  request_id uuid not null,
  body text not null default '', subject text not null default '', angle text not null default '', ai_draft text,
  version bigint not null default 1,
  updated_at timestamptz not null default clock_timestamp()
);
alter table message_drafts enable row level security;
create policy drafts_read_own on message_drafts for select to authenticated using (artist_id=auth.uid());
grant select on message_drafts to authenticated;

create or replace function save_message_draft(p_entry uuid, p_request uuid, p_version bigint, p_body text, p_subject text, p_angle text, p_ai text)
returns message_drafts language plpgsql security definer set search_path=public as $$
declare d message_drafts;
begin
  perform 1 from pipeline_entries where id=p_entry and artist_id=auth.uid() for update;
  if not found then raise exception 'Deal not found'; end if;
  select * into d from message_drafts where pipeline_entry_id=p_entry for update;
  if found then
    if p_version is distinct from d.version then raise exception 'Draft changed in another browser' using errcode='40001'; end if;
    update message_drafts set body=p_body,subject=p_subject,angle=p_angle,ai_draft=p_ai,
      version=version+1,updated_at=clock_timestamp() where pipeline_entry_id=p_entry returning * into d;
  else
    if p_version is not null then raise exception 'Draft changed in another browser' using errcode='40001'; end if;
    if exists(select 1 from scheduled_messages where id=p_request) then raise exception 'This draft was already queued'; end if;
    insert into message_drafts(pipeline_entry_id,artist_id,request_id,body,subject,angle,ai_draft)
      values(p_entry,auth.uid(),p_request,p_body,p_subject,p_angle,p_ai) returning * into d;
  end if;
  return d;
end $$;

create or replace function queue_message(p_id uuid,p_entry uuid,p_to text,p_subject text,p_body text,p_at timestamptz,p_human boolean,p_ai text default null,p_draft_version bigint default null)
returns scheduled_messages language plpgsql security definer set search_path=public as $$
declare e pipeline_entries; m scheduled_messages; recipient text; d message_drafts;
begin
  select * into e from pipeline_entries where id=p_entry and artist_id=auth.uid() for update;
  if not found then raise exception 'Deal not found'; end if;
  select * into m from scheduled_messages where id=p_id and artist_id=auth.uid();
  if found then
    if m.pipeline_entry_id<>p_entry then raise exception 'Request belongs to another deal'; end if;
    return m;
  end if;
  if e.status in ('passed','dead') then raise exception 'Reopen this deal before scheduling an email'; end if;
  select coalesce(nullif(trim(p.email),''),nullif(trim(c.email),'')) into recipient
    from pipeline_entries x left join people p on p.id=x.person_id left join contacts c on c.id=x.contact_id where x.id=p_entry;
  if lower(trim(p_to)) is distinct from lower(recipient) or p_to !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then raise exception 'The contact address changed. Review the recipient before sending'; end if;
  if p_subject ~ E'[\r\n]' or length(trim(p_body))=0 then raise exception 'A valid subject and message are required'; end if;
  if exists(select 1 from scheduled_messages where pipeline_entry_id=p_entry and status in ('scheduled','ready','sending','uncertain'))
    then raise exception 'A message is already waiting on this deal. Review it first'; end if;
  select * into d from message_drafts where pipeline_entry_id=p_entry for update;
  if p_draft_version is not null and (d.request_id is distinct from p_id or d.version is distinct from p_draft_version)
    then raise exception 'Draft changed in another browser' using errcode='40001'; end if;
  insert into scheduled_messages(id,artist_id,pipeline_entry_id,to_email,subject,body,send_at,human,ai_draft)
    values(p_id,auth.uid(),p_entry,trim(p_to),p_subject,p_body,p_at,p_human,p_ai) returning * into m;
  if d.request_id=p_id then delete from message_drafts where pipeline_entry_id=p_entry; end if;
  return m;
end $$;

create or replace function edit_queued_message(p_id uuid,p_version timestamptz,p_body text,p_subject text,p_to text)
returns scheduled_messages language plpgsql security definer set search_path=public as $$
declare m scheduled_messages; recipient text;
begin
  perform 1 from pipeline_entries where id=(select pipeline_entry_id from scheduled_messages where id=p_id and artist_id=auth.uid()) for update;
  select * into m from scheduled_messages where id=p_id and artist_id=auth.uid() for update;
  if not found then raise exception 'Message not found'; end if;
  if m.status not in ('scheduled','ready') or m.updated_at is distinct from p_version then raise exception 'This message changed or is already sending. Refresh to review it'; end if;
  select coalesce(nullif(trim(p.email),''),nullif(trim(c.email),'')) into recipient
    from pipeline_entries e left join people p on p.id=e.person_id left join contacts c on c.id=e.contact_id where e.id=m.pipeline_entry_id;
  if lower(trim(p_to)) is distinct from lower(recipient) or p_to !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Review the current contact address first'; end if;
  if p_subject ~ E'[\r\n]' or length(trim(p_body))=0 then raise exception 'A valid subject and message are required'; end if;
  update scheduled_messages set body=p_body,subject=p_subject,to_email=trim(p_to) where id=p_id returning * into m;
  return m;
end $$;

create or replace function cancel_queued_message(p_id uuid,p_version timestamptz)
returns scheduled_messages language plpgsql security definer set search_path=public as $$
declare m scheduled_messages;
begin
  perform 1 from pipeline_entries where id=(select pipeline_entry_id from scheduled_messages where id=p_id and artist_id=auth.uid()) for update;
  select * into m from scheduled_messages where id=p_id and artist_id=auth.uid() for update;
  if not found then raise exception 'Message not found'; end if;
  if m.status='canceled' then return m; end if;
  if m.status not in ('scheduled','ready','failed') or m.updated_at is distinct from p_version then raise exception 'This message changed or is already sending. It cannot be canceled'; end if;
  update scheduled_messages set status='canceled',cancel_reason='Canceled by you' where id=p_id returning * into m;
  return m;
end $$;

create or replace function confirm_manual_message(p_id uuid,p_version timestamptz)
returns scheduled_messages language plpgsql security definer set search_path=public as $$
declare m scheduled_messages;
begin
  perform 1 from pipeline_entries where id=(select pipeline_entry_id from scheduled_messages where id=p_id and artist_id=auth.uid()) for update;
  select * into m from scheduled_messages where id=p_id and artist_id=auth.uid() for update;
  if not found or m.status <> 'ready' or m.updated_at is distinct from p_version then raise exception 'Only a draft awaiting review can be marked sent'; end if;
  update scheduled_messages set status='sent',sent_at=now(),sent_via='manual',activity_recorded=true where id=p_id returning * into m;
  insert into activities(pipeline_entry_id,kind,body,source) values(m.pipeline_entry_id,'email_out',m.body,'manual');
  return m;
end $$;

create or replace function claim_scheduled_message(p_id uuid,p_version timestamptz)
returns setof scheduled_messages language plpgsql security definer set search_path=public as $$
declare m scheduled_messages; e pipeline_entries; recipient text;
begin
  select * into e from pipeline_entries where id=(select pipeline_entry_id from scheduled_messages where id=p_id) for update;
  select * into m from scheduled_messages where id=p_id for update;
  if not found or m.status <> 'scheduled' or m.send_at>now() or m.updated_at is distinct from p_version then return; end if;
  if exists(select 1 from scheduled_messages where pipeline_entry_id=e.id and id<>p_id and status in ('sending','uncertain')) then return; end if;
  if e.artist_id is distinct from m.artist_id or e.status in ('passed','dead') then
    update scheduled_messages set status='canceled',cancel_reason='Deal is closed' where id=p_id; return;
  end if;
  select coalesce(nullif(trim(p.email),''),nullif(trim(c.email),'')) into recipient
    from pipeline_entries x left join people p on p.id=x.person_id left join contacts c on c.id=x.contact_id where x.id=e.id;
  if lower(trim(m.to_email)) is distinct from lower(recipient) then
    update scheduled_messages set status='ready',cancel_reason='Contact email changed — review the recipient' where id=p_id; return;
  end if;
  if not m.human and not coalesce((select allow_auto_send from artists where id=m.artist_id),false) then
    update scheduled_messages set status='ready',cancel_reason='Assistant sending is off' where id=p_id; return;
  end if;
  return query update scheduled_messages set status='sending',attempt_started_at=clock_timestamp(),
    rfc_message_id='gc-'||id::text||'@gig.nicholasrains.com',cancel_reason=null where id=p_id returning *;
end $$;

create or replace function release_queued_message(p_id uuid,p_version timestamptz)
returns scheduled_messages language plpgsql security definer set search_path=public as $$
declare m scheduled_messages; e pipeline_entries; recipient text;
begin
  select * into e from pipeline_entries where id=(select pipeline_entry_id from scheduled_messages where id=p_id and artist_id=auth.uid()) for update;
  select * into m from scheduled_messages where id=p_id and artist_id=auth.uid() for update;
  if not found or m.status<>'ready' or m.updated_at is distinct from p_version then raise exception 'Message changed. Refresh to review it'; end if;
  if e.status in ('passed','dead') then raise exception 'Reopen this deal first'; end if;
  if exists(select 1 from scheduled_messages where pipeline_entry_id=e.id and id<>p_id and status in ('scheduled','sending','uncertain')) then raise exception 'Another message is pending delivery on this deal'; end if;
  select coalesce(nullif(trim(p.email),''),nullif(trim(c.email),'')) into recipient
    from pipeline_entries x left join people p on p.id=x.person_id left join contacts c on c.id=x.contact_id where x.id=e.id;
  if lower(trim(m.to_email)) is distinct from lower(recipient) then raise exception 'Edit the draft to confirm the new contact address first'; end if;
  update scheduled_messages set status='scheduled',human=true,send_at=now(),cancel_reason=null where id=p_id returning * into m;
  return m;
end $$;
create or replace function resolve_message_delivery(p_id uuid,p_version timestamptz,p_sent boolean)
returns scheduled_messages language plpgsql security definer set search_path=public as $$
declare m scheduled_messages;
begin
  perform 1 from pipeline_entries where id=(select pipeline_entry_id from scheduled_messages where id=p_id and artist_id=auth.uid()) for update;
  select * into m from scheduled_messages where id=p_id and artist_id=auth.uid() for update;
  if not found or m.status<>'uncertain' or m.updated_at is distinct from p_version then raise exception 'Delivery status changed. Refresh to review it'; end if;
  update scheduled_messages set status=case when p_sent then 'sent' else 'canceled' end,
    sent_at=case when p_sent then now() else null end,sent_via=case when p_sent then 'manual_verification' else null end,
    activity_recorded=p_sent,cancel_reason=case when p_sent then 'You confirmed delivery in Gmail' else 'You verified this message was not sent' end
    where id=p_id returning * into m;
  if p_sent then insert into activities(pipeline_entry_id,kind,body,source) values(m.pipeline_entry_id,'email_out',m.body,'manual'); end if;
  return m;
end $$;
revoke all on function release_queued_message(uuid,timestamptz),resolve_message_delivery(uuid,timestamptz,boolean) from public;
grant execute on function release_queued_message(uuid,timestamptz),resolve_message_delivery(uuid,timestamptz,boolean) to authenticated;

-- Browser mutations go through the versioned, ownership-checked RPCs above.
revoke insert,update,delete on scheduled_messages from authenticated,anon;
revoke all on function save_message_draft(uuid,uuid,bigint,text,text,text,text) from public;
revoke all on function queue_message(uuid,uuid,text,text,text,timestamptz,boolean,text,bigint) from public;
revoke all on function edit_queued_message(uuid,timestamptz,text,text,text) from public;
revoke all on function cancel_queued_message(uuid,timestamptz) from public;
revoke all on function confirm_manual_message(uuid,timestamptz) from public;
revoke all on function claim_scheduled_message(uuid,timestamptz) from public,authenticated,anon;
grant execute on function save_message_draft(uuid,uuid,bigint,text,text,text,text),queue_message(uuid,uuid,text,text,text,timestamptz,boolean,text,bigint),edit_queued_message(uuid,timestamptz,text,text,text),cancel_queued_message(uuid,timestamptz),confirm_manual_message(uuid,timestamptz) to authenticated;
grant execute on function claim_scheduled_message(uuid,timestamptz) to service_role;

create or replace function close_deal_messages() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if TG_OP='DELETE' or (new.status in ('passed','dead') and old.status is distinct from new.status) then
    if exists(select 1 from scheduled_messages where pipeline_entry_id=old.id and status in ('sending','uncertain')) then
      raise exception 'An email is sending or needs delivery verification. Resolve it before closing or deleting the deal';
    end if;
    update scheduled_messages set status='canceled',cancel_reason='Deal closed' where pipeline_entry_id=old.id and status in ('scheduled','ready');
  end if;
  if TG_OP='DELETE' then return old; end if;
  if old.status is distinct from new.status and old.google_event_id is not null then new.gig_date_dirty := true; end if;
  return new;
end $$;
drop trigger if exists close_deal_messages on pipeline_entries;
create trigger close_deal_messages before update of status or delete on pipeline_entries for each row execute function close_deal_messages();

-- Archive shared venues; deleting one must never cascade into private work.
alter table venues add column if not exists archived_at timestamptz;
drop policy if exists venues_write_all on venues;
create policy venues_insert_members on venues for insert to authenticated with check(true);
create policy venues_update_members on venues for update to authenticated using(true) with check(true);
revoke delete on venues from authenticated,anon;
alter table pipeline_entries drop constraint if exists pipeline_entries_venue_id_fkey;
alter table pipeline_entries add constraint pipeline_entries_venue_id_fkey foreign key(venue_id) references venues(id) on delete restrict;

-- Google imports are separate from manual preferences and replace atomically.
-- Old rows cannot be reliably classified; retain them and expose a review hint.
alter table availability add column if not exists source text not null default 'legacy';
alter table availability alter column source set default 'manual';
create table if not exists calendar_busy_days (
  artist_id uuid not null references artists(id) on delete cascade, event_id text not null, day date not null,
  primary key(artist_id,event_id,day)
);
alter table calendar_busy_days enable row level security;
create policy calendar_busy_read on calendar_busy_days for select to authenticated using(artist_id=auth.uid());
grant select on calendar_busy_days to authenticated;
create or replace function replace_calendar_busy(p_artist uuid,p_from date,p_until date,p_rows jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_artist::text,40));
  delete from calendar_busy_days where artist_id=p_artist and day between p_from and p_until;
  insert into calendar_busy_days(artist_id,event_id,day)
    select p_artist,x.event_id,x.day from jsonb_to_recordset(p_rows) as x(event_id text,day date)
    where x.day between p_from and p_until on conflict do nothing;
end $$;
revoke all on function replace_calendar_busy(uuid,date,date,jsonb) from public,authenticated,anon;
grant execute on function replace_calendar_busy(uuid,date,date,jsonb) to service_role;

create table if not exists reminder_deliveries (
  entry_id uuid not null references pipeline_entries(id) on delete cascade,
  reminder_at timestamptz not null, endpoint text not null,
  status text not null check(status in ('sending','pending','sent')),
  updated_at timestamptz not null default now(), primary key(entry_id,reminder_at,endpoint)
);
alter table reminder_deliveries enable row level security;
create or replace function claim_reminder_delivery(p_entry uuid,p_at timestamptz,p_endpoint text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  insert into reminder_deliveries(entry_id,reminder_at,endpoint,status) values(p_entry,p_at,p_endpoint,'sending')
  on conflict(entry_id,reminder_at,endpoint) do update set status='sending',updated_at=now()
    where reminder_deliveries.status='pending' or (reminder_deliveries.status='sending' and reminder_deliveries.updated_at<now()-interval '5 minutes');
  return found;
end $$;
revoke all on function claim_reminder_delivery(uuid,timestamptz,text) from public,authenticated,anon;
grant execute on function claim_reminder_delivery(uuid,timestamptz,text) to service_role;

grant all on message_drafts,calendar_busy_days,reminder_deliveries to service_role;
revoke insert,update,delete on message_drafts,calendar_busy_days,reminder_deliveries from authenticated,anon;

alter publication supabase_realtime add table message_drafts,calendar_busy_days;
-- Connection health is read from artists; publish changes so open browsers
-- can show revoked/reconnected access without waiting for a page reload.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='artists') then
    alter publication supabase_realtime add table artists;
  end if;
end $$;
commit;

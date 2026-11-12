\set ON_ERROR_STOP on
begin;
create function pg_temp.check_it(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label;end if; raise notice 'PASS: %',label;end $$;
create function pg_temp.must_fail(q text,expected text) returns void language plpgsql as $$
declare caught boolean:=false; begin
  begin execute q;exception when others then if position(expected in sqlerrm)=0 then raise;end if;caught:=true;end;
  perform pg_temp.check_it(caught,expected);
end $$;
insert into auth.users(id,email) values ('10000000-0000-4000-8000-000000000001','one@example.com'),('10000000-0000-4000-8000-000000000002','two@example.com');
insert into venues(id,name) values('20000000-0000-4000-8000-000000000001','Shared room');
insert into people(id,email) values('30000000-0000-4000-8000-000000000001','buyer@example.com');
insert into pipeline_entries(id,artist_id,venue_id,person_id,status) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','lead'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','lead');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select pg_temp.must_fail($q$select save_message_draft('40000000-0000-4000-8000-000000000002',gen_random_uuid(),null,'stolen','','',null)$q$,'Deal not found');
select save_message_draft('40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',null,'full body','subject','angle',null);
select pg_temp.must_fail($q$select save_message_draft('40000000-0000-4000-8000-000000000001',gen_random_uuid(),null,'overwrite','','',null)$q$,'Draft changed');
select pg_temp.check_it((select body='full body' and version=1 from message_drafts),'conflicting browser preserves saved draft');
select queue_message('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','buyer@example.com','subject','full body',now(),true,null,1);
select queue_message('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','buyer@example.com','subject','full body',now(),true,null,1);
select pg_temp.check_it((select count(*)=1 from scheduled_messages),'idempotent queue');
select pg_temp.check_it((select count(*)=0 from message_drafts),'queue commits draft atomically');
select pg_temp.must_fail($q$select queue_message(gen_random_uuid(),'40000000-0000-4000-8000-000000000001','buyer@example.com','subject','another',now(),true)$q$,'already waiting');
select pg_temp.must_fail($q$update scheduled_messages set status='sent'$q$,'permission denied');
select pg_temp.must_fail($q$select * from claim_scheduled_message('50000000-0000-4000-8000-000000000001',now())$q$,'permission denied');
select updated_at as stale_version from scheduled_messages \gset
select edit_queued_message(id,updated_at,'edited body','edited subject','buyer@example.com') from scheduled_messages;
reset role;
select pg_temp.check_it((select count(*)=0 from claim_scheduled_message('50000000-0000-4000-8000-000000000001',:'stale_version')),'stale worker snapshot cannot send');
select updated_at as current_version from scheduled_messages \gset
select pg_temp.check_it((select count(*)=1 from claim_scheduled_message('50000000-0000-4000-8000-000000000001',:'current_version')),'current snapshot claims once');
select pg_temp.check_it((select count(*)=0 from claim_scheduled_message('50000000-0000-4000-8000-000000000001',:'current_version')),'second claim cannot send');
set local role authenticated;
select pg_temp.must_fail($q$select cancel_queued_message(id,updated_at) from scheduled_messages$q$,'cannot be canceled');
select pg_temp.must_fail($q$select edit_queued_message(id,updated_at,'late edit','subject','buyer@example.com') from scheduled_messages$q$,'already sending');
select pg_temp.must_fail($q$update pipeline_entries set status='dead'$q$,'email is sending');
select pg_temp.must_fail($q$delete from pipeline_entries$q$,'email is sending');
reset role;
update scheduled_messages set status='uncertain';
set local role authenticated;
select resolve_message_delivery(id,updated_at,false) from scheduled_messages;
select pg_temp.check_it((select status='canceled' from scheduled_messages),'verified unsent message can be restored');
select queue_message('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','buyer@example.com','subject','body',now(),true);
select updated_at as current_version from scheduled_messages where status='scheduled' \gset
update people set email='corrected@example.com';
reset role;
select pg_temp.check_it((select count(*)=0 from claim_scheduled_message('50000000-0000-4000-8000-000000000002',:'current_version')),'contact change stops worker');
select pg_temp.check_it((select status='ready' from scheduled_messages where id='50000000-0000-4000-8000-000000000002'),'contact change leaves reviewable message');
set local role authenticated;
select pg_temp.must_fail($q$select release_queued_message(id,updated_at) from scheduled_messages where status='ready'$q$,'confirm the new contact');
select edit_queued_message(id,updated_at,'body','subject','corrected@example.com') from scheduled_messages where status='ready';
select release_queued_message(id,updated_at) from scheduled_messages where status='ready';
update pipeline_entries set status='dead';
select pg_temp.check_it((select count(*)=0 from scheduled_messages where status='scheduled'),'closing cancels queue atomically');
select pg_temp.must_fail($q$select queue_message(gen_random_uuid(),'40000000-0000-4000-8000-000000000001','corrected@example.com','subject','body',now(),true)$q$,'Reopen this deal');
update pipeline_entries set status='lead';
select queue_message('50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','corrected@example.com','subject','body',now(),false);
select updated_at as current_version from scheduled_messages where status='scheduled' \gset
reset role;
select pg_temp.check_it((select count(*)=0 from claim_scheduled_message('50000000-0000-4000-8000-000000000003',:'current_version')),'assistant off prevents automatic claim');
set local role authenticated;
select confirm_manual_message(id,updated_at) from scheduled_messages where status='ready';
select pg_temp.check_it((select count(*)=1 from activities where body='body' and kind='email_out'),'manual confirmation logs full content');
select pg_temp.must_fail($q$delete from venues$q$,'permission denied');
update venues set archived_at=now();
select pg_temp.check_it((select count(*)=1 from pipeline_entries),'archive preserves private deal');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select pg_temp.check_it((select count(*)=1 from pipeline_entries),'archive preserves other artist deal');
select pg_temp.check_it((select count(*)=0 from scheduled_messages),'queue reads respect ownership');
select pg_temp.must_fail($q$select resolve_message_delivery('50000000-0000-4000-8000-000000000001',now(),true)$q$,'Delivery status changed');
reset role;
select pg_temp.must_fail($q$delete from venues$q$,'violates foreign key constraint');
insert into availability(artist_id,day,status,source) values('10000000-0000-4000-8000-000000000001','2026-11-08','available','manual');
select replace_calendar_busy('10000000-0000-4000-8000-000000000001','2026-11-08','2026-12-08','[{"event_id":"event1","day":"2026-11-08"}]');
select replace_calendar_busy('10000000-0000-4000-8000-000000000001','2026-11-08','2026-12-08','[]');
select pg_temp.check_it((select count(*)=0 from calendar_busy_days),'deleted calendar events clear imported busy days');
select pg_temp.check_it((select count(*)=1 from availability where status='available'),'reconciliation preserves manual availability');
select pg_temp.check_it(claim_reminder_delivery('40000000-0000-4000-8000-000000000001',now(),'device'),'reminder first claim');
select pg_temp.check_it(not claim_reminder_delivery('40000000-0000-4000-8000-000000000001',now(),'device'),'reminder overlapping claim refused');
update reminder_deliveries set status='pending';
select pg_temp.check_it(claim_reminder_delivery('40000000-0000-4000-8000-000000000001',now(),'device'),'failed reminder retries');
update reminder_deliveries set status='sent';
select pg_temp.check_it(not claim_reminder_delivery('40000000-0000-4000-8000-000000000001',now(),'device'),'successful reminder never repeats');
select pg_temp.check_it(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='artists'),'connection health updates reach open browsers');
rollback;

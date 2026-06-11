-- Migration 010: comprehensive staging.
-- Happy path: lead → pitched → talks → hold (hard ticket) → booked → played.
-- Exits: passed (recyclable no — agent may circle back) and dead (terminal —
-- never resurrect, never resurface). Follow-up is no longer a stage; it becomes
-- a scheduled ACTION in slice B. Run in the Supabase SQL editor.

alter table pipeline_entries drop constraint if exists pipeline_entries_status_check;

update pipeline_entries set status = case status
  when 'outreach' then 'lead'
  when 'waiting'  then 'talks'
  when 'followup' then 'talks'
  when 'won'      then 'booked'
  else status end
where status in ('outreach','waiting','followup','won');

alter table pipeline_entries alter column status set default 'lead';
alter table pipeline_entries add constraint pipeline_entries_status_check
  check (status in ('lead','pitched','talks','hold','booked','played','passed','dead'));

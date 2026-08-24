-- A reminder that doesn't notify you isn't a reminder. The worker pushes each
-- one once when due; the flag stops re-pushing every poll cycle.
alter table pipeline_entries add column if not exists reminder_pushed boolean not null default false;

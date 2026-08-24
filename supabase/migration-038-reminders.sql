-- "Call back tomorrow" deserves a reminder, not follow-up automation. One
-- pending reminder per deal; due reminders surface at the top of the war room.
alter table pipeline_entries
  add column if not exists reminder_at timestamptz,
  add column if not exists reminder_note text;

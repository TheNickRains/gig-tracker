-- Migration 011 (Slice B): draft + schedule sends.
-- A scheduled_messages row is a draft with a send time. At send_at the worker:
--   reply arrived since scheduling?  -> canceled (intelligent disconnect)
--   artist allow_auto_send = true    -> sent from their Gmail
--   allow_auto_send = false          -> 'ready' (app surfaces "review & send")
-- Run in the Supabase SQL editor.

create table if not exists scheduled_messages (
  id                uuid primary key default gen_random_uuid(),
  artist_id         uuid not null references artists(id) on delete cascade,
  pipeline_entry_id uuid not null references pipeline_entries(id) on delete cascade,
  to_email          text not null,
  subject           text not null,
  body              text not null,
  send_at           timestamptz not null,
  status            text not null default 'scheduled'
                      check (status in ('scheduled','ready','sent','canceled','failed')),
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);

alter table scheduled_messages enable row level security;
create policy sm_own on scheduled_messages for all to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());

create index if not exists sm_due_idx on scheduled_messages (status, send_at);

-- Live updates in the app when the worker sends/cancels/readies a message.
alter publication supabase_realtime add table scheduled_messages;

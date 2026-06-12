-- Migration 019: human-initiated gig-date edits propagate to Google Calendar.
-- The agent never edits events on its own; when the ARTIST changes/clears the
-- date in the app, this flag tells the worker to mirror that one change
-- (update or delete the event), then it clears.
-- Run in the Supabase SQL editor.
alter table pipeline_entries add column if not exists gig_date_dirty boolean not null default false;

-- Migration 016 (Slice D): the gig date + Google Calendar linkage.
-- gig_date is set in the app when a deal reaches Hold/Booked; the worker then
-- mirrors it to the artist's Google Calendar (hold = tentative event, booked =
-- confirmed), flips booked -> played after the date passes, and imports busy
-- days from their calendar into availability.
-- Run in the Supabase SQL editor.
alter table pipeline_entries add column if not exists gig_date timestamptz;
alter table pipeline_entries add column if not exists google_event_id text;

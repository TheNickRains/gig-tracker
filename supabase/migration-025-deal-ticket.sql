-- Migration 025: ticket type is a property of the DEAL (the same room hosts
-- soft- and hard-ticket nights — ATG/Majestic case). NULL = inherit the venue.
-- Run in the Supabase SQL editor.
alter table pipeline_entries add column if not exists ticket_type text
  check (ticket_type in ('soft','hard'));

-- Migration 008: Gmail push state on the connection (history cursor + watch expiry).
-- Run in the Supabase SQL editor.
alter table google_connections add column if not exists history_id text;
alter table google_connections add column if not exists watch_expiry timestamptz;

-- Migration 002: optional venue address (powers location/maps later).
-- Additive and non-breaking. Run in the Supabase SQL editor.
alter table venues add column if not exists address text;

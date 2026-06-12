-- Migration 022: first-run onboarding flag.
-- Run in the Supabase SQL editor.
alter table artists add column if not exists onboarded boolean not null default false;
-- Existing members (you, Sam) skip the welcome flow:
update artists set onboarded = true where created_at < now() - interval '1 hour';

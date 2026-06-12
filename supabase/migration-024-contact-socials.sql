-- Migration 024: optional socials on contacts (LinkedIn + Instagram).
-- Run in the Supabase SQL editor.
alter table contacts add column if not exists linkedin text;
alter table contacts add column if not exists instagram text;

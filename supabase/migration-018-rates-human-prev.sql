-- Migration 018: artist rates (the Artist RAG), human-initiated sends,
-- terminal-stage toggle memory.
-- Run in the Supabase SQL editor.

-- Soft-ticket rate (hourly/flat) and hard-ticket price range — set BY the
-- artist; the AI quotes these and is forbidden from inventing/underbidding.
alter table artists add column if not exists rate_soft text;
alter table artists add column if not exists rate_hard text;

-- Passed/Dead are toggles now: remember where the deal was to restore on un-tap.
alter table pipeline_entries add column if not exists prev_status text;

-- "Send now" is a human decision: bypasses the auto-send gate AND the
-- reply-cancel check (you're replying on purpose).
alter table scheduled_messages add column if not exists human boolean not null default false;

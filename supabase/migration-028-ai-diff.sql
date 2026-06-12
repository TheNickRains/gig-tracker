-- Migration 028: the explicit self-learning loop.
-- When a send began life as an AI generation, store that generation alongside
-- what the artist ACTUALLY sent — the tone job learns from the diffs.
-- Run in the Supabase SQL editor.
alter table scheduled_messages add column if not exists ai_draft text;

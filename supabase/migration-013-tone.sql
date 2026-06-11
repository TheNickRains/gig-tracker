-- Migration 013 (Slice C, tone-learning): the artist's voice, distilled.
-- The worker periodically reads the artist's recent SENT booking emails from
-- Gmail, has Gemini distill a "tone card" (voice traits, phrasing, sign-off),
-- and stores it here. /ai/draft injects it so drafts sound like the artist —
-- and since the corpus is what they ACTUALLY sent (including their edits to
-- AI drafts), the system learns from proposed-vs-sent differences over time.
-- Run in the Supabase SQL editor.
alter table artists add column if not exists tone_profile text;
alter table artists add column if not exists tone_updated_at timestamptz;

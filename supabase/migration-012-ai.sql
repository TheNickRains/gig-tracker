-- Migration 012 (Slice C): AI enrichment on conversation activities.
-- summary = one-line Gemini summary of an inbound reply (shown as the card
-- headline); ai_intent = classified intent (interested/date_offer/decline/
-- question/other) used for proposals — never auto-moves the stage.
-- Run in the Supabase SQL editor.
alter table activities add column if not exists summary text;
alter table activities add column if not exists ai_intent text;

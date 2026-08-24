-- Conversation bubbles must name the ACTUAL sender of each email, not the
-- deal's current contact (switching contacts was relabeling history).
-- The worker stores the From header's display name at ingest.
alter table activities add column if not exists from_name text;
